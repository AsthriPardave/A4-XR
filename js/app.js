import * as THREE from "three";

const POS_TOL_M = 0.02;
const YAW_TOL = THREE.MathUtils.degToRad(10);
const DOCK_HOLD_MS = 400;
const DOCK_GRACE_MS = 150;
const SHAPE_SPAN_M = 0.2;
const TAP_SLOP_PX = 14;
const STORAGE_KEY = "a4xr-docking-v1";
const NOTES_KEY = "a4xr-notes-v1";

const SHAPES = [
  { id: "cylinder", name: "Cilindro", color: 0xe23d3d },
  { id: "cube", name: "Cubo", color: 0xf2c14e },
  { id: "cone", name: "Cono", color: 0x2f6fed },
];

const COLS = [
  "participant_id",
  "technique",
  "trial",
  "completion_time_s",
  "pos_error_cm",
  "yaw_error_deg",
  "wrong_selections",
  "touch_count",
  "tracking_lost",
  "arm_fatigue",
];

const $ = (id) => document.getElementById(id);

const ui = {
  overlay: $("overlay"),
  touch: $("touch-layer"),
  crosshair: $("crosshair"),
  hud: $("hud"),
  technique: $("hud-technique"),
  trial: $("hud-trial"),
  status: $("hud-status"),
  instruction: $("hud-instruction"),
  detail: $("hud-detail"),
  toast: $("toast"),
  bottom: $("bottom-bar"),
  carry: $("btn-carry"),
  rotate: $("btn-rotate"),
  restart: $("btn-restart"),
  exit: $("btn-exit"),
  previewHint: $("preview-hint"),
  setup: $("screen-setup"),
  success: $("screen-success"),
  successTitle: $("success-title"),
  successStats: $("success-stats"),
  next: $("btn-next"),
  fatigue: $("screen-fatigue"),
  summary: $("screen-summary"),
  summaryTitle: $("summary-title"),
  summaryTable: $("summary-table"),
  participant: $("participant"),
  notes: $("notes"),
  xrStatus: $("xr-status"),
  savedStatus: $("saved-status"),
  btnAr: $("btn-ar"),
  btnPreview: $("btn-preview"),
  btnCsv: $("btn-csv"),
  btnOther: $("btn-other"),
  btnSetup: $("btn-setup"),
  btnClear: $("btn-clear"),
};

const debug = new URLSearchParams(location.search).has("debug");
const debugEl = document.createElement("p");
debugEl.id = "debug-readout";
debugEl.hidden = !debug;
ui.overlay.appendChild(debugEl);

const state = {
  mode: "setup",
  phase: "setup",
  technique: "touch",
  participant: "",
  trial: 1,
  blockId: "",
  wrong: 0,
  touches: 0,
  trackingLost: 0,
  selectStarted: 0,
  dockHoldStart: null,
  dockOutsideSince: 0,
  carryHeld: false,
  rotHeld: false,
  selected: null,
  match: null,
  targetYaw: 0,
  aimValid: false,
  trackingOk: true,
  sawTracking: false,
  xrSupported: false,
  leaving: false,
};

const pointers = new Map();
const gesture = {
  moved: false,
  twisting: false,
  dragging: false,
  startX: 0,
  startY: 0,
  maxPointers: 0,
  lastTwist: 0,
  lastMidX: 0,
  lastMidY: 0,
  grabOffset: new THREE.Vector3(),
};

const carryAnchor = {
  camPos: new THREE.Vector3(),
  objPos: new THREE.Vector3(),
  camQuat: new THREE.Quaternion(),
  objQuat: new THREE.Quaternion(),
};
const _euler = new THREE.Euler();

const plane = {
  ready: false,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(0, 1, 0),
  xAxis: new THREE.Vector3(1, 0, 0),
  zAxis: new THREE.Vector3(0, 0, 1),
  three: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const aimPoint = new THREE.Vector3();
const aimNormal = new THREE.Vector3(0, 1, 0);
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let camera;
let scene;
let renderer;
let reticle;
let floorMesh;
let grid;
let hitTestSource = null;
let hitTestSourceRequested = false;
let aimMessage = "Mueve el teléfono de lado a lado, apuntando a la mesa o al suelo.";
const aimQuat = new THREE.Quaternion();
const _reticleScale = new THREE.Vector3(1, 1, 1);
const _normal = new THREE.Vector3();
let ghost = null;
let pieces = [];
let lastFrameTime = performance.now();
let toastTimer = 0;
let audioCtx = null;

const orbit = {
  theta: 0.4,
  phi: 0.62,
  radius: 0.55,
  target: new THREE.Vector3(0, 0, 0),
};

init();

function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  updatePreviewCamera();

  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8ea0c4, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.4, 1.2, 0.3);
  scene.add(sun);

  floorMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 72),
    new THREE.MeshStandardMaterial({ color: 0xd9d3c8, roughness: 0.95 })
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.001;
  scene.add(floorMesh);

  grid = new THREE.GridHelper(2.2, 22, 0x8d887e, 0xc9c2b6);
  grid.position.y = 0;
  scene.add(grid);

  reticle = new THREE.Group();
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  reticle.frustumCulled = false;
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    })
  );
  disk.rotation.x = -Math.PI / 2;
  disk.renderOrder = 3;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.155, 0.2, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  ring.renderOrder = 4;
  reticle.add(disk, ring);
  scene.add(reticle);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setAnimationLoop(animate);
  $("canvas-host").appendChild(renderer.domElement);

  window.addEventListener("resize", onResize);
  window.addEventListener("focus", detectXR);
  ui.touch.addEventListener("pointerdown", onPointerDown);
  ui.touch.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  ui.touch.addEventListener("wheel", onWheel, { passive: false });
  ui.touch.addEventListener("contextmenu", (e) => e.preventDefault());

  ui.carry.addEventListener("pointerdown", onCarryDown);
  ui.carry.addEventListener("pointermove", onCarryMove);
  ui.carry.addEventListener("pointerup", onCarryUp);
  ui.carry.addEventListener("pointercancel", onCarryUp);
  ui.rotate.addEventListener("pointerdown", onRotateDown);
  ui.rotate.addEventListener("pointermove", onRotateMove);
  ui.rotate.addEventListener("pointerup", onRotateUp);
  ui.rotate.addEventListener("pointercancel", onRotateUp);
  ui.restart.addEventListener("click", restartAttempt);
  ui.exit.addEventListener("click", exitToSetup);
  ui.btnAr.addEventListener("click", () => startSession("ar"));
  if (ui.btnPreview) ui.btnPreview.addEventListener("click", () => startSession("preview"));
  ui.next.addEventListener("click", onNextTrial);
  ui.fatigue.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => answerFatigue(Number(btn.dataset.score)));
  });
  ui.btnCsv.addEventListener("click", downloadCsv);
  ui.btnOther.addEventListener("click", startOtherTechnique);
  ui.btnSetup.addEventListener("click", () => showSetup());
  ui.btnClear.addEventListener("click", clearData);
  ui.participant.addEventListener("input", refreshSetupButtons);
  if (ui.notes) {
    ui.notes.addEventListener("input", () => localStorage.setItem(NOTES_KEY, ui.notes.value));
    const savedNotes = localStorage.getItem(NOTES_KEY);
    if (savedNotes) ui.notes.value = savedNotes;
  }

  renderer.xr.addEventListener("sessionend", onSessionEnd);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onDebugKey);

  setFloorVisible(true);
  showSetup();
  detectXR();
  refreshSavedStatus();
  window.__A4_READY = true;
}

function xrBlockReason() {
  if (!window.isSecureContext) {
    const port = location.port || "80";
    return `Chrome bloquea WebXR en ${location.host} porque la página no es HTTPS ni localhost. Conecta el teléfono por USB, activa la depuración y en la computadora ejecuta: adb reverse tcp:${port} tcp:${port}. Después abre http://localhost:${port} en Chrome del teléfono.`;
  }
  if (!navigator.xr) {
    return "Este navegador no tiene WebXR. Ábrelo con Chrome y con “Google Play Services for AR” instalado, no con el navegador del fabricante.";
  }
  return "";
}

function showXrStatus(message, isError) {
  ui.xrStatus.textContent = message;
  ui.xrStatus.classList.toggle("error", !!isError);
}

async function detectXR() {
  const blocked = xrBlockReason();
  if (blocked) {
    state.xrSupported = false;
    showXrStatus(blocked, true);
    refreshSetupButtons();
    return;
  }
  try {
    state.xrSupported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch (err) {
    state.xrSupported = false;
    showXrStatus("No se pudo comprobar AR. " + (err && err.message ? err.message : ""), true);
    refreshSetupButtons();
    return;
  }
  showXrStatus(
    state.xrSupported
      ? "AR listo."
      : "Este Chrome no puede abrir una sesión AR. Instala Google Play Services for AR y actualiza Chrome.",
    !state.xrSupported
  );
  refreshSetupButtons();
}

function refreshSetupButtons() {
  ui.btnAr.disabled = false;
  if (ui.btnPreview) ui.btnPreview.disabled = false;
}

function refreshSavedStatus() {
  if (!ui.savedStatus) return;
  const rows = loadRows();
  ui.savedStatus.textContent = rows.length
    ? `Ensayos guardados en este navegador: ${rows.length}.`
    : "Todavía no hay ensayos guardados.";
}

let handlingSessionEnd = false;

function showSetup() {
  const session = renderer.xr.getSession();
  if (session && !handlingSessionEnd) {
    state.leaving = true;
    session.end();
    return;
  }
  state.phase = "setup";
  state.mode = "setup";
  state.leaving = false;
  state.carryHeld = false;
  state.rotHeld = false;
  clearTaskObjects();
  reticle.visible = false;
  setFloorVisible(true);
  ui.setup.hidden = false;
  ui.success.hidden = true;
  ui.fatigue.hidden = true;
  ui.summary.hidden = true;
  ui.hud.hidden = true;
  ui.bottom.hidden = true;
  ui.touch.hidden = true;
  ui.crosshair.hidden = true;
  refreshSavedStatus();
  refreshSetupButtons();
}

function readSetup() {
  state.participant = ui.participant.value.trim();
  state.technique = document.querySelector('input[name="technique"]:checked').value;
  if (ui.notes) localStorage.setItem(NOTES_KEY, ui.notes.value.trim());
}

async function startSession(mode) {
  readSetup();
  if (!state.participant) {
    showXrStatus("Escribe un código, por ejemplo P1, y pulsa otra vez.", true);
    ui.participant.focus();
    return;
  }

  state.blockId = `${state.participant}-${state.technique}-${Date.now()}`;
  state.trial = 1;
  state.mode = mode;

  if (mode === "ar") {
    const blocked = xrBlockReason();
    if (blocked) {
      showXrStatus(blocked, true);
      state.mode = "setup";
      return;
    }
    let session = null;
    try {
      session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: ui.overlay },
      });
    } catch (err) {
      console.error(err);
      showXrStatus("No se abrió AR. " + (err && err.message ? err.message : "Error desconocido."), true);
      state.mode = "setup";
      return;
    }
    try {
      renderer.xr.setReferenceSpaceType("local");
      await renderer.xr.setSession(session);
      beginHitTest(session);
    } catch (err) {
      console.error(err);
      showXrStatus("La sesión AR no arrancó. " + (err && err.message ? err.message : ""), true);
      state.mode = "setup";
      try { session.end(); } catch { /* already closed */ }
      return;
    }
    setFloorVisible(false);
  } else {
    setFloorVisible(true);
    updatePreviewCamera();
  }

  ui.setup.hidden = true;
  beginTrial();
}

function onSessionEnd() {
  cancelHitTest();
  state.carryHeld = false;
  state.rotHeld = false;
  const unexpected = state.mode === "ar" && !state.leaving;
  handlingSessionEnd = true;
  if (unexpected) toast("La sesión AR terminó. Los ensayos ya guardados siguen en el navegador.");
  showSetup();
  handlingSessionEnd = false;
}

function beginTrial() {
  clearTaskObjects();
  state.selected = null;
  state.match = null;
  state.wrong = 0;
  state.touches = 0;
  state.trackingLost = 0;
  state.selectStarted = 0;
  state.dockHoldStart = null;
  state.dockOutsideSince = 0;
  state.carryHeld = false;
  state.rotHeld = false;
  state.sawTracking = false;
  state.trackingOk = true;
  plane.ready = false;
  gesture.dragging = false;
  gesture.twisting = false;
  gesture.moved = false;
  setPhase("placing");
}

function restartAttempt() {
  if (state.phase === "setup" || state.phase === "fatigue") return;
  beginTrial();
  toast("Intento reiniciado, sin guardarlo.");
}

function exitToSetup() {
  const session = renderer.xr.getSession();
  if (session) {
    state.leaving = true;
    session.end();
  } else {
    showSetup();
  }
}

function setPhase(phase) {
  state.phase = phase;
  const manipulating = phase === "placing" || phase === "selecting" || phase === "docking";
  ui.hud.hidden = !manipulating && phase !== "success";
  ui.bottom.hidden = !manipulating;
  ui.touch.hidden = !manipulating;
  ui.setup.hidden = true;
  ui.success.hidden = phase !== "success";
  ui.fatigue.hidden = phase !== "fatigue";
  ui.summary.hidden = phase !== "summary";
  ui.carry.hidden = !(phase === "docking" && state.technique === "carry");
  ui.rotate.hidden = ui.carry.hidden;
  if (ui.previewHint) ui.previewHint.hidden = state.mode !== "preview" || !manipulating;
  ui.crosshair.hidden = true;
  if (!ui.carry.hidden && !state.carryHeld) ui.carry.textContent = "Desplazar";
  if (!ui.rotate.hidden && !state.rotHeld) ui.rotate.textContent = "Rotar";
  ui.carry.classList.toggle("held", state.carryHeld);
  ui.rotate.classList.toggle("held", state.rotHeld);

  const touchName = state.technique === "touch" ? "Gestos" : "Carry";
  ui.technique.textContent = touchName;
  ui.technique.style.borderColor = state.technique === "touch" ? "#d86b4a" : "#e2b15a";
  ui.trial.textContent = `Ensayo ${state.trial}/3`;

  const labels = {
    placing: "Colocar",
    selecting: "Elegir",
    docking: "Encajar",
    success: "Encajado",
  };
  ui.status.textContent = labels[phase] || "";
  ui.status.classList.toggle("ok", phase === "success");
  if (debug) debugEl.hidden = phase !== "docking";
  updateInstruction();
}

function updateInstruction() {
  if (state.phase === "placing") {
    ui.instruction.textContent = "Apunta a una mesa o al suelo. Cuando el círculo se ponga verde, tócalo para dejar los objetos ahí.";
    ui.detail.textContent = aimMessage;
    ui.status.classList.remove("warn");
  } else if (state.phase === "selecting") {
    ui.instruction.textContent = "Toca el objeto del mismo color y forma que el fantasma.";
    ui.detail.textContent = `Selecciones incorrectas: ${state.wrong}`;
  } else if (state.phase === "docking") {
    const name = state.selected ? state.selected.userData.name : "";
    ui.instruction.textContent = state.technique === "touch"
      ? "Un dedo mueve la figura sobre la mesa, sin cambiar su tamaño. Dos dedos la inclinan y la giran."
      : "Desplazar la mueve sobre la mesa, siempre del mismo tamaño. Rotar cambia su inclinación.";
    ui.detail.textContent = `Seleccionado: ${name}. Incorrectas: ${state.wrong}. ${proximityText()}`;
    ui.status.classList.add("warn");
  } else if (state.phase === "success") {
    ui.instruction.textContent = "Dentro de la tolerancia.";
    ui.detail.textContent = "";
    ui.status.classList.remove("warn");
  }
}

function proximityText() {
  if (!state.selected || !ghost || !dockMeasure) return "";
  const { pos, ang } = dockMeasure;
  if (pos <= POS_TOL_M && ang <= YAW_TOL) return "Quédate quieto…";
  if (pos < 0.08 && ang < THREE.MathUtils.degToRad(30)) return "Cerca.";
  return "Lejos.";
}

function setFloorVisible(visible) {
  floorMesh.visible = visible;
  grid.visible = visible;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updatePreviewCamera() {
  const { theta, phi, radius, target } = orbit;
  camera.position.set(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

function getCam() {
  if (renderer.xr.isPresenting) {
    const rig = renderer.xr.getCamera();
    if (rig.cameras && rig.cameras[0]) return rig.cameras[0];
  }
  return camera;
}

function setRayFromClient(clientX, clientY) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ndc.x = (clientX / w) * 2 - 1;
  ndc.y = -(clientY / h) * 2 + 1;
  const cam = getCam();
  cam.updateMatrixWorld();
  raycaster.setFromCamera(ndc, cam);
}

function setPlane(point, normal) {
  plane.ready = true;
  plane.point.copy(point);
  plane.normal.copy(normal).normalize();
  if (plane.normal.y < 0) plane.normal.multiplyScalar(-1);
  const hint = Math.abs(plane.normal.dot(_v1.set(0, 0, 1))) > 0.9 ? _v2.set(1, 0, 0) : _v2.set(0, 0, 1);
  plane.xAxis.crossVectors(hint, plane.normal).normalize();
  plane.zAxis.crossVectors(plane.normal, plane.xAxis).normalize();
  plane.three.setFromNormalAndCoplanarPoint(plane.normal, plane.point);
}

function projectToPlane(point, target = _v3) {
  const dist = plane.three.distanceToPoint(point);
  return target.copy(point).addScaledVector(plane.normal, -dist);
}

function pointOnPlane(x, z, target = new THREE.Vector3()) {
  return target
    .copy(plane.point)
    .addScaledVector(plane.xAxis, x)
    .addScaledVector(plane.zAxis, z);
}

function randomTilt() {
  const spread = THREE.MathUtils.degToRad(55);
  return {
    pitch: (Math.random() - 0.5) * 2 * spread,
    yaw: Math.random() * Math.PI * 2,
    roll: (Math.random() - 0.5) * 2 * spread,
  };
}

function applyOrientation(object) {
  _euler.set(object.userData.pitch || 0, object.userData.yaw || 0, object.userData.roll || 0, "YXZ");
  object.quaternion.setFromEuler(_euler);
  lockScale(object);
}

function placeObject(object, worldPos, pitch, yaw, roll) {
  object.position.copy(worldPos);
  object.position.y = plane.point.y + SHAPE_SPAN_M * 0.5;
  object.userData.pitch = pitch;
  object.userData.yaw = yaw;
  object.userData.roll = roll;
  applyOrientation(object);
}

function nudgeOrientation(object, dp, dy, dr) {
  const center = object.position.clone();
  if (dp) {
    _q1.setFromAxisAngle(_v1.set(1, 0, 0), dp);
    object.quaternion.multiply(_q1);
  }
  if (dy) {
    _q1.setFromAxisAngle(_v1.set(0, 1, 0), dy);
    object.quaternion.multiply(_q1);
  }
  if (dr) {
    _q1.setFromAxisAngle(_v1.set(0, 0, 1), dr);
    object.quaternion.multiply(_q1);
  }
  object.quaternion.normalize();
  object.position.copy(center);
  lockScale(object);
  _euler.setFromQuaternion(object.quaternion, "YXZ");
  object.userData.pitch = _euler.x;
  object.userData.yaw = _euler.y;
  object.userData.roll = _euler.z;
}

function orientationGap(a, b) {
  return a.quaternion.angleTo(b.quaternion);
}

let dockMeasure = null;

function measureDock() {
  const pos = state.selected.position.distanceTo(ghost.position);
  const ang = orientationGap(state.selected, ghost);
  dockMeasure = { pos, ang };
  return dockMeasure;
}

function angleDiffSigned(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function angleDiff(a, b) {
  return Math.abs(angleDiffSigned(a, b));
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function makeMaterial(color, opacity) {
  const ghostMode = opacity < 1;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.04,
    transparent: ghostMode,
    opacity,
    emissive: new THREE.Color(ghostMode ? color : 0x000000),
    emissiveIntensity: ghostMode ? 0.35 : 0,
    depthWrite: !ghostMode,
  });
}

function faceMaterial(color, opacity) {
  const ghostMode = opacity < 1;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.04,
    transparent: ghostMode,
    opacity,
    emissive: new THREE.Color(ghostMode ? color : 0x000000),
    emissiveIntensity: ghostMode ? 0.22 : 0,
    depthWrite: !ghostMode,
  });
}

function addHeadingMark(root) {
  const mark = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 14, 14),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.3 })
  );
  mark.position.set(0, 0, SHAPE_SPAN_M * 0.56);
  mark.userData.fixedMaterial = true;
  mark.raycast = () => {};
  root.add(mark);
}

function buildCylinder(opacity) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 32), [
    faceMaterial(0x3d8bfd, opacity),
    faceMaterial(0xe74c3c, opacity),
    faceMaterial(0xf1c40f, opacity),
  ]);
  mesh.userData.coloredFaces = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function buildCube(opacity) {
  const colors = [0xe74c3c, 0x2ecc71, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    colors.map((color) => faceMaterial(color, opacity))
  );
  mesh.userData.coloredFaces = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function buildCone(opacity) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 28), [
    faceMaterial(0x8e44ad, opacity),
    faceMaterial(0x1abc9c, opacity),
  ]);
  mesh.userData.coloredFaces = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

const BUILDERS = { cylinder: buildCylinder, cube: buildCube, cone: buildCone };

function groundCenter(group) {
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.children.forEach((child) => {
    child.position.sub(center);
  });
}

function normalizeShapeSpan(group, targetSpan) {
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(_v1);
  const span = Math.max(size.x, size.y, size.z);
  if (span < 1e-6) return 1;
  const uniform = targetSpan / span;
  group.scale.set(uniform, uniform, uniform);
  group.userData.uniformScale = uniform;
  return uniform;
}

function paint(group, color, opacity) {
  group.traverse((obj) => {
    if (!obj.isMesh || obj.userData.fixedMaterial || obj.userData.coloredFaces) return;
    obj.material = makeMaterial(color, opacity);
  });
}

function setEmissive(group, hex, intensity) {
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material || obj.userData.fixedMaterial || obj.userData.coloredFaces) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat.emissive) return;
      mat.emissive.setHex(hex);
      mat.emissiveIntensity = intensity;
    });
  });
}

function selectionRing(color) {
  const outer = SHAPE_SPAN_M * 0.38;
  const inner = SHAPE_SPAN_M * 0.3;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 40),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  ring.raycast = () => {};
  ring.visible = false;
  ring.userData.fixedScale = true;
  return ring;
}

function pickVolume() {
  const radius = SHAPE_SPAN_M * 0.34;
  const height = SHAPE_SPAN_M * 0.45;
  const pick = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pick.position.y = 0;
  pick.userData.fixedScale = true;
  return pick;
}

function ghostFloorRing(colorHex) {
  const outer = SHAPE_SPAN_M * 0.42;
  const inner = SHAPE_SPAN_M * 0.34;
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 40),
    new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0;
  marker.raycast = () => {};
  marker.userData.fixedScale = true;
  return marker;
}

function createObject(shape, opacity) {
  const root = new THREE.Group();
  const body = BUILDERS[shape.id](opacity);
  groundCenter(body);
  normalizeShapeSpan(body, SHAPE_SPAN_M);
  root.add(body);
  addHeadingMark(root);
  paint(body, shape.color, opacity);
  root.userData.shapeId = shape.id;
  root.userData.name = shape.name;
  root.userData.color = shape.color;
  root.userData.yaw = 0;
  root.traverse((obj) => {
    obj.userData.piece = root;
  });
  return root;
}

function clearTaskObjects() {
  for (const obj of [ghost, ...pieces]) {
    if (!obj) continue;
    scene.remove(obj);
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }
  ghost = null;
  pieces = [];
  state.selected = null;
}

function randomLayout() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const spin = Math.random() * Math.PI * 2;
    const spots = [0, 2.15, 4.25].map((base) => {
      const a = base + spin + (Math.random() - 0.5) * 0.45;
      const d = 0.34 + Math.random() * 0.05;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d };
    });
    const nearTarget = spots.every((s) => Math.hypot(s.x, s.z) >= 0.33 && Math.hypot(s.x, s.z) <= 0.41);
    let separated = true;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = spots[i].x - spots[j].x;
        const dz = spots[i].z - spots[j].z;
        if (Math.hypot(dx, dz) < 0.3) separated = false;
      }
    }
    if (nearTarget && separated) return spots;
  }
  return [
    { x: 0.36, z: 0.04 },
    { x: -0.2, z: 0.31 },
    { x: -0.18, z: -0.32 },
  ];
}

function spawnTrial() {
  clearTaskObjects();
  const matchIndex = Math.floor(Math.random() * SHAPES.length);
  const ghostTilt = randomTilt();
  state.targetYaw = ghostTilt.yaw;
  const targetPos = pointOnPlane(0, 0);

  ghost = createObject(SHAPES[matchIndex], 0.55);
  ghost.userData.isGhost = true;
  ghost.traverse((obj) => {
    obj.raycast = () => {};
  });
  placeObject(ghost, targetPos, ghostTilt.pitch, ghostTilt.yaw, ghostTilt.roll);
  ghost.add(ghostFloorRing(SHAPES[matchIndex].color));
  scene.add(ghost);

  const spots = randomLayout();
  const order = SHAPES.map((_, i) => i).sort(() => Math.random() - 0.5);
  pieces = order.map((shapeIndex, i) => {
    const obj = createObject(SHAPES[shapeIndex], 1);
    obj.userData.ring = selectionRing(0xfff4d2);
    obj.add(obj.userData.ring);
    obj.add(pickVolume());
    const tilt = randomTilt();
    placeObject(obj, pointOnPlane(spots[i].x, spots[i].z), tilt.pitch, tilt.yaw, tilt.roll);
    scene.add(obj);
    return obj;
  });
  state.match = pieces.find((p) => p.userData.shapeId === SHAPES[matchIndex].id);
  state.selected = null;
}

function placeWorkspace() {
  if (!state.aimValid || !reticle.visible) {
    toast("El círculo sigue amarillo. Recorre la mesa hasta que se ponga verde.");
    return;
  }
  reticle.updateMatrixWorld(true);
  reticle.matrix.decompose(aimPoint, aimQuat, _v1);
  setPlane(aimPoint, aimNormal.set(0, 1, 0));
  if (state.mode === "preview") {
    orbit.target.copy(plane.point);
    updatePreviewCamera();
  }
  spawnTrial();
  reticle.visible = false;
  setPhase("selecting");
}

function pieceFromHit(hits) {
  for (const hit of hits) {
    let obj = hit.object;
    while (obj) {
      if (obj.userData && obj.userData.piece && !obj.userData.piece.userData.isGhost) return obj.userData.piece;
      obj = obj.parent;
    }
  }
  return null;
}

function onTap(clientX, clientY) {
  if (state.phase === "placing") {
    if (!state.aimValid) {
      toast("El círculo sigue amarillo. Mueve el teléfono sobre la mesa hasta que se ponga verde.");
      return;
    }
    if (!tapHitsCircle(clientX, clientY)) {
      toast("Toca el círculo verde para colocar los objetos.");
      return;
    }
    placeWorkspace();
    return;
  }
  if (state.phase !== "selecting") return;
  setRayFromClient(clientX, clientY);
  const picked = pieceFromHit(raycaster.intersectObjects(pieces, true));
  if (!picked) {
    toast("Toca uno de los tres objetos.");
    return;
  }
  if (picked !== state.match) {
    state.wrong += 1;
    flashWrong();
    toast("Ese no coincide con el objetivo.");
    setEmissive(picked, 0xff3344, 0.7);
    setTimeout(() => {
      if (picked !== state.selected) setEmissive(picked, 0x000000, 0);
    }, 280);
    updateInstruction();
    return;
  }
  selectMatch(picked);
}

function selectMatch(picked) {
  state.selected = picked;
  state.selectStarted = performance.now();
  state.dockHoldStart = null;
  state.dockOutsideSince = 0;
  picked.userData.ring.visible = true;
  setEmissive(picked, 0xfff1c9, 0.45);
  beep(660, 0.06);
  if (navigator.vibrate) navigator.vibrate(25);
  setPhase("docking");
}

function lockScale(object) {
  object.scale.set(1, 1, 1);
}

function panSelected(dxPx, dyPx) {
  if (!state.selected) return;
  const cam = getCam();
  cam.getWorldQuaternion(_q1);
  const right = _v2.set(1, 0, 0).applyQuaternion(_q1);
  const forward = _v3.set(0, 0, -1).applyQuaternion(_q1);
  right.y = 0;
  forward.y = 0;
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  right.normalize();
  forward.normalize();
  const step = 0.0008;
  state.selected.position.addScaledVector(right, dxPx * step);
  state.selected.position.addScaledVector(forward, dyPx * step);
  state.selected.position.y = plane.point.y + SHAPE_SPAN_M * 0.5;
  lockScale(state.selected);
}

function updateCarry() {
  if (state.phase !== "docking" || !state.selected) return;
  const cam = getCam();
  if (state.carryHeld && state.mode === "ar") {
    cam.getWorldPosition(_v1);
    state.selected.position.copy(carryAnchor.objPos).add(_v2.copy(_v1).sub(carryAnchor.camPos));
    state.selected.position.y = plane.point.y + SHAPE_SPAN_M * 0.5;
    lockScale(state.selected);
  }
  if (state.rotHeld && state.mode === "ar") {
    cam.getWorldQuaternion(_q1);
    _q2.copy(carryAnchor.camQuat).invert();
    _q2.multiply(_q1);
    _q1.copy(carryAnchor.objQuat).multiply(_q2);
    state.selected.quaternion.copy(_q1);
    state.selected.position.copy(carryAnchor.objPos);
    state.selected.position.y = plane.point.y + SHAPE_SPAN_M * 0.5;
    lockScale(state.selected);
  }
}

function checkDock(now) {
  if (state.phase !== "docking" || !state.selected || !ghost) return;
  const { pos, ang } = measureDock();
  const inside = pos <= POS_TOL_M && ang <= YAW_TOL;
  if (inside) {
    state.dockOutsideSince = 0;
    if (state.dockHoldStart == null) state.dockHoldStart = now;
    else if (now - state.dockHoldStart >= DOCK_HOLD_MS) completeDock(pos, ang);
  } else if (state.dockHoldStart != null) {
    if (!state.dockOutsideSince) state.dockOutsideSince = now;
    if (now - state.dockOutsideSince > DOCK_GRACE_MS) {
      state.dockHoldStart = null;
      state.dockOutsideSince = 0;
    }
  } else {
    state.dockOutsideSince = 0;
  }
  if (debug) {
    debugEl.hidden = false;
    debugEl.textContent =
      `pos ${(pos * 100).toFixed(1)} cm\nyaw ${THREE.MathUtils.radToDeg(ang).toFixed(1)}°\n` +
      `tol 2 cm / 10°`;
  }
  if (state.phase === "docking") updateInstruction();
}

function completeDock(posErr, yawErr) {
  if (state.phase !== "docking") return;
  const seconds = (performance.now() - state.selectStarted) / 1000;
  const row = {
    block_id: state.blockId,
    participant_id: state.participant,
    technique: state.technique,
    trial: state.trial,
    completion_time_s: round2(seconds),
    pos_error_cm: round2(posErr * 100),
    yaw_error_deg: round2(THREE.MathUtils.radToDeg(yawErr)),
    wrong_selections: state.wrong,
    touch_count: state.touches,
    tracking_lost: state.trackingLost,
    arm_fatigue: "",
  };
  const rows = loadRows();
  rows.push(row);
  try {
    saveRows(rows);
  } catch (err) {
    console.warn("No se pudieron guardar los datos", err);
  }
  console.info("[A4]", row);

  state.carryHeld = false;
  state.rotHeld = false;
  ui.carry.classList.remove("held");
  setEmissive(state.selected, 0x39d98a, 0.55);
  setEmissive(ghost, 0x39d98a, 0.7);
  if (state.selected.userData.ring) {
    state.selected.userData.ring.material.color.setHex(0x39d98a);
  }
  flashDocked();
  beep(880, 0.08);
  if (navigator.vibrate) navigator.vibrate(60);

  ui.successTitle.textContent = state.trial < 3 ? "Encajado" : "Encajado · último ensayo";
  ui.successStats.innerHTML = "";
  const bits = [
    ["Tiempo", `${row.completion_time_s.toFixed(2)} s`],
    ["Error de posición", `${row.pos_error_cm.toFixed(2)} cm`],
    ["Error de giro", `${row.yaw_error_deg.toFixed(2)}°`],
    ["Selecciones incorrectas", String(row.wrong_selections)],
    ["Toques", String(row.touch_count)],
    ["Pérdidas de tracking", String(row.tracking_lost)],
  ];
  for (const [k, v] of bits) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    ui.successStats.append(dt, dd);
  }
  ui.next.textContent = state.trial < 3 ? "Siguiente ensayo" : "Pregunta de fatiga";
  setPhase("success");
}

function onNextTrial() {
  if (state.trial >= 3) {
    setPhase("fatigue");
    ui.hud.hidden = true;
    ui.bottom.hidden = true;
    ui.touch.hidden = true;
    ui.crosshair.hidden = true;
    reticle.visible = false;
    return;
  }
  state.trial += 1;
  beginTrial();
}

function answerFatigue(score) {
  const rows = loadRows();
  rows.forEach((row) => {
    if (row.block_id === state.blockId) row.arm_fatigue = score;
  });
  saveRows(rows);
  showSummary(score);
}

function showSummary(score) {
  const rows = loadRows().filter((r) => r.block_id === state.blockId);
  const tech = state.technique === "touch" ? "Gestos táctiles" : "Carry";
  ui.summaryTitle.textContent = `${state.participant} · ${tech}`;
  ui.summaryTable.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Ensayo</th><th>s</th><th>cm</th><th>°</th><th>Mal</th><th>Toques</th></tr></thead>";
  const body = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.trial}</td><td>${Number(r.completion_time_s).toFixed(1)}</td><td>${Number(r.pos_error_cm).toFixed(1)}</td><td>${Number(r.yaw_error_deg).toFixed(1)}</td><td>${r.wrong_selections}</td><td>${r.touch_count}</td>`;
    body.appendChild(tr);
  });
  table.appendChild(body);
  const note = document.createElement("p");
  note.className = "lead";
  note.textContent = `How tired are your arms? ${score} / 5. Notas: ${localStorage.getItem(NOTES_KEY) || "—"}.`;
  ui.summaryTable.append(table, note);
  setPhase("summary");
  ui.hud.hidden = true;
  ui.bottom.hidden = true;
  ui.touch.hidden = true;
  ui.crosshair.hidden = true;
  reticle.visible = false;
}

function startOtherTechnique() {
  const next = state.technique === "touch" ? "carry" : "touch";
  const input = document.querySelector(`input[name="technique"][value="${next}"]`);
  if (input) input.checked = true;
  exitToSetup();
}

function countTouch() {
  if (state.phase === "selecting" || state.phase === "docking") state.touches += 1;
}

function onPointerDown(e) {
  if (ui.touch.hidden) return;
  e.preventDefault();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  try { ui.touch.setPointerCapture(e.pointerId); } catch { /* synthetic events and some overlays */ }
  if (pointers.size === 0) {
    gesture.moved = false;
    gesture.dragging = false;
    gesture.twisting = false;
    gesture.startX = e.clientX;
    gesture.startY = e.clientY;
    gesture.maxPointers = 0;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture.maxPointers = Math.max(gesture.maxPointers, pointers.size);
  countTouch();
  if (pointers.size >= 2) {
    gesture.dragging = false;
    gesture.twisting = true;
    gesture.lastTwist = pointerAngle();
    const mid = pointerMid();
    gesture.lastMidX = mid.x;
    gesture.lastMidY = mid.y;
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const dx = e.clientX - gesture.startX;
  const dy = e.clientY - gesture.startY;
  if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) gesture.moved = true;

  if (isOrbitGesture(e)) {
    if (gesture.moved) orbitBy(e.movementX, e.movementY);
    return;
  }

  if (state.phase !== "docking" || state.technique !== "touch" || !state.selected) return;

  if (pointers.size >= 2 || (e.shiftKey && pointers.size === 1 && e.pointerType === "mouse")) {
    if (pointers.size >= 2) {
      const ang = pointerAngle();
      let delta = ang - gesture.lastTwist;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      gesture.lastTwist = ang;
      const mid = pointerMid();
      const mdx = mid.x - gesture.lastMidX;
      const mdy = mid.y - gesture.lastMidY;
      gesture.lastMidX = mid.x;
      gesture.lastMidY = mid.y;
      nudgeOrientation(state.selected, -mdy * 0.008, -delta, mdx * 0.008);
    } else if (e.shiftKey) {
      nudgeOrientation(state.selected, 0, 0, -e.movementX * 0.01);
    } else {
      nudgeOrientation(state.selected, -e.movementY * 0.01, -e.movementX * 0.01, 0);
    }
    gesture.twisting = true;
    gesture.dragging = false;
    return;
  }

  if (pointers.size === 1 && gesture.moved && !gesture.twisting) {
    gesture.dragging = true;
    panSelected(e.movementX, e.movementY);
  }
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    const tap = !gesture.moved && gesture.maxPointers === 1 && !gesture.twisting;
    gesture.dragging = false;
    gesture.twisting = false;
    gesture.maxPointers = 0;
    if (tap) onTap(e.clientX, e.clientY);
  } else if (pointers.size === 1) {
    gesture.twisting = false;
    gesture.dragging = false;
    gesture.moved = true;
  }
}

function onWheel(e) {
  e.preventDefault();
}

function isOrbitGesture(e) {
  if (state.mode !== "preview") return false;
  if (e.altKey || (e.buttons & 2)) return true;
  if (state.phase === "placing" || state.phase === "selecting") return true;
  return false;
}

function orbitBy(dx, dy) {
  orbit.theta -= dx * 0.005;
  orbit.phi = THREE.MathUtils.clamp(orbit.phi - dy * 0.004, 0.28, 1.35);
  updatePreviewCamera();
}

function pointerAngle() {
  const pts = [...pointers.values()];
  if (pts.length < 2) return 0;
  return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
}

function pointerMid() {
  const pts = [...pointers.values()];
  if (!pts.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  pts.forEach((p) => {
    x += p.x;
    y += p.y;
  });
  return { x: x / pts.length, y: y / pts.length };
}

function onCarryDown(e) {
  if (ui.carry.hidden || !state.selected) return;
  e.preventDefault();
  e.stopPropagation();
  try { ui.carry.setPointerCapture(e.pointerId); } catch { /* the hold still starts if capture is unavailable */ }
  state.rotHeld = false;
  ui.rotate.classList.remove("held");
  ui.rotate.textContent = "Rotar";
  state.carryHeld = true;
  getCam().getWorldPosition(carryAnchor.camPos);
  carryAnchor.objPos.copy(state.selected.position);
  ui.carry.classList.add("held");
  ui.carry.textContent = "Soltar";
  countTouch();
}

function onCarryMove(e) {
  if (!state.carryHeld || !state.selected) return;
  if (state.mode === "preview") panSelected(e.movementX, e.movementY);
}

function onCarryUp(e) {
  if (!state.carryHeld) return;
  state.carryHeld = false;
  ui.carry.classList.remove("held");
  ui.carry.textContent = "Desplazar";
  if (e && ui.carry.hasPointerCapture?.(e.pointerId)) ui.carry.releasePointerCapture(e.pointerId);
}

function onRotateDown(e) {
  if (ui.rotate.hidden || !state.selected) return;
  e.preventDefault();
  e.stopPropagation();
  try { ui.rotate.setPointerCapture(e.pointerId); } catch { /* hold still starts */ }
  state.carryHeld = false;
  ui.carry.classList.remove("held");
  ui.carry.textContent = "Desplazar";
  state.rotHeld = true;
  getCam().getWorldQuaternion(carryAnchor.camQuat);
  carryAnchor.objQuat.copy(state.selected.quaternion);
  carryAnchor.objPos.copy(state.selected.position);
  ui.rotate.classList.add("held");
  ui.rotate.textContent = "Girando";
  countTouch();
}

function onRotateMove(e) {
  if (!state.rotHeld || !state.selected || state.mode !== "preview") return;
  if (e.shiftKey) nudgeOrientation(state.selected, 0, 0, -e.movementX * 0.01);
  else nudgeOrientation(state.selected, -e.movementY * 0.01, -e.movementX * 0.01, 0);
}

function onRotateUp(e) {
  if (!state.rotHeld) return;
  state.rotHeld = false;
  ui.rotate.classList.remove("held");
  ui.rotate.textContent = "Rotar";
  if (e && ui.rotate.hasPointerCapture?.(e.pointerId)) ui.rotate.releasePointerCapture(e.pointerId);
}

function noteTracking(ok) {
  const active = state.phase === "selecting" || state.phase === "docking";
  if (!active) {
    state.trackingOk = ok;
    if (ok) state.sawTracking = true;
    return;
  }
  if (state.sawTracking && state.trackingOk && !ok) state.trackingLost += 1;
  state.trackingOk = ok;
  if (ok) state.sawTracking = true;
}

function beginHitTest(session) {
  cancelHitTest();
  if (!session) return;
  hitTestSourceRequested = true;
  session.requestReferenceSpace("viewer").then((viewerSpace) => {
    if (renderer.xr.getSession() !== session) return null;
    return session.requestHitTestSource({ space: viewerSpace });
  }).then((source) => {
    if (source && renderer.xr.getSession() === session) hitTestSource = source;
  }).catch((err) => {
    console.warn("hit-test source failed", err);
    hitTestSourceRequested = false;
  });
}

function cancelHitTest() {
  if (hitTestSource && typeof hitTestSource.cancel === "function") {
    try { hitTestSource.cancel(); } catch { /* already cancelled with the session */ }
  }
  hitTestSource = null;
  hitTestSourceRequested = false;
}

function setReticleColor(valid) {
  const color = valid ? 0x3cba7a : 0xf1c40f;
  reticle.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material.color) obj.material.color.setHex(color);
  });
  ui.crosshair.classList.toggle("is-ready", valid);
}

function showHitReticle(matrix, horizontal) {
  reticle.matrix.copy(matrix);
  reticle.matrixAutoUpdate = false;
  reticle.matrixWorldNeedsUpdate = true;
  reticle.visible = true;
  reticle.matrix.decompose(aimPoint, aimQuat, _v1);
  aimNormal.set(0, 1, 0).transformDirection(matrix);
  if (aimNormal.y < 0) aimNormal.multiplyScalar(-1);
  state.aimValid = horizontal;
  setReticleColor(horizontal);
}

function showSearchCircle() {
  const cam = getCam();
  cam.updateMatrixWorld();
  cam.getWorldPosition(_v1);
  cam.getWorldDirection(_v2);
  _v3.copy(_v1).addScaledVector(_v2, 0.85);
  _q1.setFromUnitVectors(_normal.set(0, 1, 0), _v2.negate());
  _reticleScale.set(0.55, 0.55, 0.55);
  reticle.matrix.compose(_v3, _q1, _reticleScale);
  _reticleScale.set(1, 1, 1);
  reticle.matrixAutoUpdate = false;
  reticle.matrixWorldNeedsUpdate = true;
  reticle.visible = true;
  state.aimValid = false;
  setReticleColor(false);
}

function isHorizontalHit(matrix) {
  return Math.abs(_normal.set(0, 1, 0).transformDirection(matrix).y) >= 0.78;
}

function tapHitsCircle(clientX, clientY) {
  if (!reticle.visible || !state.aimValid) return false;
  reticle.updateMatrixWorld(true);
  setRayFromClient(clientX, clientY);
  if (raycaster.intersectObject(reticle, true).length > 0) return true;

  const cam = getCam();
  const center = _v1.setFromMatrixPosition(reticle.matrix);
  _q1.setFromRotationMatrix(reticle.matrix);
  const edge = _v2.copy(center).add(_normal.set(0.2, 0, 0).applyQuaternion(_q1));
  center.project(cam);
  edge.project(cam);
  if (center.z < -1 || center.z > 1) return false;
  const sx = (center.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-center.y * 0.5 + 0.5) * window.innerHeight;
  const ex = (edge.x * 0.5 + 0.5) * window.innerWidth;
  const ey = (-edge.y * 0.5 + 0.5) * window.innerHeight;
  const radius = Math.max(44, Math.hypot(ex - sx, ey - sy) * 1.45);
  return Math.hypot(clientX - sx, clientY - sy) <= radius;
}

function updateReticle(frame) {
  if (frame) sampleTracking(frame);

  if (state.phase !== "placing") {
    reticle.visible = false;
    ui.crosshair.classList.remove("is-ready");
    return;
  }

  if (state.mode === "preview") {
    raycaster.setFromCamera(ndc.set(0, 0), camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, _v1);
    if (hit) {
      _m1.compose(_v1, _q1.identity(), _reticleScale);
      showHitReticle(_m1, true);
      aimMessage = "Superficie plana. Toca el círculo verde.";
    } else {
      showSearchCircle();
      aimMessage = "Apunta el centro a la mesa.";
    }
    noteTracking(true);
    refreshAimText();
    return;
  }

  const referenceSpace = renderer.xr.getReferenceSpace();
  const session = renderer.xr.getSession();
  if (session && !hitTestSource && !hitTestSourceRequested) beginHitTest(session);

  if (frame && hitTestSource && referenceSpace) {
    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length) {
      const pose = hitTestResults[0].getPose(referenceSpace);
      if (pose) {
        _m1.fromArray(pose.transform.matrix);
        const horizontal = isHorizontalHit(_m1);
        showHitReticle(_m1, horizontal);
        aimMessage = horizontal
          ? "Superficie plana. Toca el círculo verde."
          : "Esa superficie no es horizontal. Apunta a la mesa o al suelo.";
        refreshAimText();
        return;
      }
    }
  }

  showSearchCircle();
  aimMessage = hitTestSource
    ? "Mueve el teléfono de lado a lado sobre la mesa hasta que el círculo se ponga verde."
    : "Preparando el detector. Mueve el teléfono un momento.";
  refreshAimText();
}

function refreshAimText() {
  if (state.phase !== "placing") return;
  if (ui.detail.textContent !== aimMessage) ui.detail.textContent = aimMessage;
}

function sampleTracking(frame) {
  if (state.mode !== "ar" || !frame) return;
  const referenceSpace = renderer.xr.getReferenceSpace();
  const pose = referenceSpace ? frame.getViewerPose(referenceSpace) : null;
  let hitOk = false;
  if (hitTestSource) {
    const hits = frame.getHitTestResults(hitTestSource);
    hitOk = hits.length > 0;
  }
  if (!hitTestSource) return;
  noteTracking(!!pose && hitOk);
}

function animate(timestamp, frame) {
  const now = timestamp || performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  updateReticle(frame);

  updateCarry(dt || 0.016);
  checkDock(now);

  if (state.mode === "preview" && state.phase === "placing") updateInstruction();
  renderer.render(scene, camera);
}

function onDebugKey(e) {
  if (!debug || state.phase !== "docking" || !state.selected || !plane.ready) return;
  const step = e.shiftKey ? 0.002 : 0.01;
  const yawStep = THREE.MathUtils.degToRad(e.shiftKey ? 1 : 5);
  const pos = state.selected.position.clone();
  if (e.key === "ArrowLeft") pos.addScaledVector(plane.xAxis, -step);
  else if (e.key === "ArrowRight") pos.addScaledVector(plane.xAxis, step);
  else if (e.key === "ArrowUp") pos.addScaledVector(plane.zAxis, -step);
  else if (e.key === "ArrowDown") pos.addScaledVector(plane.zAxis, step);
  else if (e.key === "q" || e.key === "Q") nudgeOrientation(state.selected, 0, -yawStep, 0);
  else if (e.key === "e" || e.key === "E") nudgeOrientation(state.selected, 0, yawStep, 0);
  else return;
  e.preventDefault();
  if (e.key.startsWith("Arrow")) {
    state.selected.position.copy(pos);
    lockScale(state.selected);
  }
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1600);
}

function flashWrong() {
  ui.overlay.classList.add("is-wrong");
  beep(220, 0.07);
  setTimeout(() => ui.overlay.classList.remove("is-wrong"), 220);
}

function flashDocked() {
  ui.overlay.classList.add("is-docked");
  setTimeout(() => ui.overlay.classList.remove("is-docked"), 700);
}

function beep(freq, dur) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    /* autoplay can block until the first gesture; ignore */
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function loadRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveRows(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  refreshSavedStatus();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv() {
  const rows = loadRows();
  if (!rows.length) {
    toast("No hay ensayos para descargar.");
    return;
  }
  const lines = [COLS.join(",")];
  rows.forEach((row) => {
    lines.push(COLS.map((col) => csvEscape(row[col])).join(","));
  });
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "a4-docking.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function clearData() {
  localStorage.removeItem(STORAGE_KEY);
  refreshSavedStatus();
  toast("Datos borrados de este navegador.");
  if (state.phase === "summary" || state.phase === "setup") showSetup();
}
