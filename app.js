const DB_NAME = "genshin_tracker_db";
const DB_VERSION = 1;
const STORE = "app";

const DEFAULT_DATA = {
  name: "TSARITZA",
  protos: 215,
  wishes: 42,
  pity: 11,
  guaranteed: false,
  goalWishes: 180,
  targetDate: "2026-12-16",
  earnedToday: 0,
  lastDay: todayISO(),
  totalEarned: 0,
  history: []
};

let datos = null;
let db = null;
let previousBalanceBeforeEdit = 0;

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("es-ES");
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function save() {
  await dbSet("datos", datos);
}

async function init() {
  try {
    db = await openDB();
    const stored = await dbGet("datos");

    if (stored) {
      datos = normalizeData(stored);
    } else {
      datos = structuredClone(DEFAULT_DATA);
      await save();
    }

    rolloverIfNeeded();
    updateUI();
    bindEvents();
  } catch (error) {
    console.error(error);
    alert("No se pudo abrir la base de datos local. Prueba con Chrome/Firefox o abre el proyecto desde un servidor local.");
  }
}

function normalizeData(d) {
  return {
    ...structuredClone(DEFAULT_DATA),
    ...d,
    protos: Math.max(0, Number(d.protos) || 0),
    wishes: Math.max(0, Number(d.wishes) || 0),
    pity: Math.min(89, Math.max(0, Number(d.pity) || 0)),
    goalWishes: Number(d.goalWishes) === 169 ? 169 : 180,
    earnedToday: Math.max(0, Number(d.earnedToday) || 0),
    totalEarned: Math.max(0, Number(d.totalEarned) || 0),
    history: Array.isArray(d.history) ? d.history : []
  };
}

function rolloverIfNeeded() {
  const now = todayISO();
  if (datos.lastDay !== now) {
    if (datos.earnedToday > 0) {
      addHistoryEntry(datos.lastDay, datos.earnedToday, "Cierre automático");
    }
    datos.earnedToday = 0;
    datos.lastDay = now;
    save();
  }
}

function equivalentProtos() {
  return datos.protos + (datos.wishes + datos.pity) * 160;
}

function daysRemaining() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const target = new Date(`${datos.targetDate}T00:00:00`);
  const diff = target.getTime() - now.getTime();

  return Math.max(0, Math.ceil(diff / 86400000));
}

function calculations() {
  const target = datos.goalWishes * 160;
  const current = equivalentProtos();
  const missing = Math.max(0, target - current);
  const days = daysRemaining();

  const baseQuota = days > 0 ? Math.ceil(missing / days) : missing;
  const remainingToday = Math.max(0, baseQuota - datos.earnedToday);

  // Diferencia respecto a la cuota acumulada ideal desde el inicio.
  // El historial sirve para medir el ritmo real sin modificar el saldo.
  const totalDays = Math.max(1, Math.ceil(
    (new Date(`${datos.targetDate}T00:00:00`) - new Date()) / 86400000
  ));
  const elapsed = Math.max(0, 109 - daysRemaining());
  const idealEarned = Math.max(0, elapsed * baseQuota);
  const performance = datos.totalEarned - idealEarned;

  const aheadDays = baseQuota > 0 ? performance / baseQuota : 0;

  let guarantee;
  if (datos.guaranteed) {
    guarantee = Math.max(0, 90 - datos.pity);
  } else {
    guarantee = Math.max(0, (90 - datos.pity) + 90);
  }

  return {
    target, current, missing, days, baseQuota,
    remainingToday, guarantee, performance, aheadDays
  };
}

function updateUI() {
  rolloverIfNeeded();

  const c = calculations();

  document.getElementById("target-name").textContent = datos.name || "TSARITZA";
  document.getElementById("target-date").textContent = formatDate(datos.targetDate);

  document.getElementById("protos").textContent = formatNumber(datos.protos);
  document.getElementById("wishes").textContent = datos.wishes;
  document.getElementById("pity").textContent = datos.pity;

  const fifty = document.getElementById("fifty");
  fifty.textContent = datos.guaranteed ? "Garantizado" : "50/50";
  fifty.className = datos.guaranteed ? "value green" : "value red";

  document.getElementById("total-wishes").textContent =
    `${(c.current / 160).toFixed(1)} deseos (${Math.floor(c.current / 160)})`;

  const percentage = c.target > 0
    ? Math.min(100, (c.current / c.target) * 100)
    : 100;

  document.getElementById("percentage").textContent = `${percentage.toFixed(1)}%`;
  document.getElementById("progress").style.width = `${percentage}%`;
  document.getElementById("progress-goal-label").textContent =
    `Progreso hacia ${datos.goalWishes} deseos`;

  document.getElementById("missing").textContent =
    `Faltan ${formatNumber(c.missing)} 💎`;
  document.getElementById("days").textContent =
    `${c.days} días`;

  document.getElementById("daily").textContent =
    `${formatNumber(c.baseQuota)} 💎`;

  document.getElementById("daily-info").textContent =
    c.days > 0
      ? `${formatNumber(c.missing)} restantes ÷ ${c.days} días`
      : "Fecha objetivo alcanzada";

  document.getElementById("earned-today").textContent =
    `${formatNumber(datos.earnedToday)} 💎`;

  document.getElementById("remaining-today").textContent =
    `${formatNumber(c.remainingToday)} 💎`;

  const surplus = c.performance;
  const surplusEl = document.getElementById("surplus");
  surplusEl.textContent =
    `${surplus >= 0 ? "+" : ""}${formatNumber(Math.round(surplus))} 💎`;
  surplusEl.className = surplus >= 0 ? "excess" : "deficit";

  document.getElementById("base-quota").textContent =
    `${formatNumber(c.baseQuota)} 💎`;

  document.getElementById("ahead").textContent =
    `${c.aheadDays >= 0 ? "" : ""}${c.aheadDays.toFixed(1)} días`;

  document.getElementById("guarantee").textContent =
    `${c.guarantee} deseos`;

  document.getElementById("reserve-label").textContent =
    `${datos.goalWishes} deseos`;

  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  if (!datos.history.length) {
    list.innerHTML = `
      <div class="history-item">
        <div class="history-date">
          <strong>Aún no hay registros</strong>
          <span>Introduce tu saldo actual para comenzar.</span>
        </div>
      </div>`;
    return;
  }

  [...datos.history].reverse().slice(0, 30).forEach(item => {
    const row = document.createElement("div");
    row.className = "history-item";

    const positive = item.delta >= 0;
    row.innerHTML = `
      <div class="history-date">
        <strong>${formatDate(item.date)}</strong>
        <span>${item.note || "Registro"} • saldo ${formatNumber(item.balance)} 💎</span>
        <div class="history-total">Ganado acumulado: ${formatNumber(item.totalEarned || 0)} 💎</div>
      </div>
      <div class="${positive ? "excess" : "deficit"}">
        ${positive ? "+" : ""}${formatNumber(item.delta)} 💎
      </div>
    `;

    list.appendChild(row);
  });
}

function addHistoryEntry(date, delta, note) {
  datos.history.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    date,
    delta,
    balance: datos.protos,
    totalEarned: datos.totalEarned,
    note
  });

  if (datos.history.length > 100) {
    datos.history = datos.history.slice(-100);
  }
}

function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

function openAdd() {
  rolloverIfNeeded();
  previousBalanceBeforeEdit = datos.protos;
  document.getElementById("previous-balance").textContent =
    `${formatNumber(previousBalanceBeforeEdit)} 💎`;
  document.getElementById("input-protos").value = "";
  document.getElementById("delta-preview").textContent =
    "Introduce tu saldo para calcular la diferencia.";
  openModal("modal-add");
  setTimeout(() => document.getElementById("input-protos").focus(), 100);
}

function previewDelta() {
  const input = Number(document.getElementById("input-protos").value);

  if (!Number.isFinite(input) || input < 0) {
    document.getElementById("delta-preview").textContent =
      "Introduce un número válido.";
    return;
  }

  const delta = input - previousBalanceBeforeEdit;

  if (delta > 0) {
    document.getElementById("delta-preview").innerHTML =
      `📈 Has ganado <b>${formatNumber(delta)} 💎</b> desde el último saldo.`;
  } else if (delta < 0) {
    document.getElementById("delta-preview").innerHTML =
      `📉 El saldo bajó <b>${formatNumber(Math.abs(delta))} 💎</b>. Se registrará como gasto/ajuste y no contará como protogemas ganadas.`;
  } else {
    document.getElementById("delta-preview").textContent =
      "El saldo no cambió.";
  }
}

async function saveAdd() {
  const input = Number(document.getElementById("input-protos").value);

  if (!Number.isFinite(input) || input < 0) {
    alert("Introduce un saldo válido.");
    return;
  }

  const delta = Math.floor(input) - previousBalanceBeforeEdit;
  datos.protos = Math.floor(input);

  if (delta > 0) {
    datos.earnedToday += delta;
    datos.totalEarned += delta;
  }

  addHistoryEntry(
    todayISO(),
    delta,
    delta > 0 ? "Saldo actual registrado" : "Saldo actualizado"
  );

  await save();
  closeModal("modal-add");
  updateUI();
}

function openConfig() {
  document.getElementById("cfg-name").value = datos.name;
  document.getElementById("cfg-protos").value = datos.protos;
  document.getElementById("cfg-wishes").value = datos.wishes;
  document.getElementById("cfg-goal").value = String(datos.goalWishes);
  document.getElementById("cfg-date").value = datos.targetDate;
  openModal("modal-config");
}

async function saveConfig() {
  const oldProtos = datos.protos;
  const newProtos = Math.max(0, Math.floor(Number(document.getElementById("cfg-protos").value) || 0));

  datos.name = document.getElementById("cfg-name").value.trim() || "TSARITZA";
  datos.protos = newProtos;
  datos.wishes = Math.max(0, Math.floor(Number(document.getElementById("cfg-wishes").value) || 0));
  datos.goalWishes = Number(document.getElementById("cfg-goal").value) === 169 ? 169 : 180;
  datos.targetDate = document.getElementById("cfg-date").value || "2026-12-16";

  // Cambiar saldo desde configuración NO lo cuenta como ingreso.
  if (newProtos !== oldProtos) {
    addHistoryEntry(todayISO(), newProtos - oldProtos, "Ajuste manual de configuración");
  }

  await save();
  closeModal("modal-config");
  updateUI();
}

function openPity() {
  document.getElementById("input-pity").value = datos.pity;
  document.getElementById("input-guaranteed").value = String(datos.guaranteed);
  openModal("modal-pity");
}

async function savePity() {
  const pity = Number(document.getElementById("input-pity").value);

  if (!Number.isFinite(pity) || pity < 0 || pity > 89) {
    alert("El pity debe estar entre 0 y 89.");
    return;
  }

  datos.pity = Math.floor(pity);
  datos.guaranteed = document.getElementById("input-guaranteed").value === "true";

  await save();
  closeModal("modal-pity");
  updateUI();
}

async function closeDay() {
  rolloverIfNeeded();

  const earned = datos.earnedToday;
  if (earned > 0) {
    addHistoryEntry(todayISO(), earned, "Cierre del día");
  }

  datos.earnedToday = 0;
  datos.lastDay = todayISO();

  await save();
  updateUI();

  alert(earned > 0
    ? `Día cerrado. Registraste ${formatNumber(earned)} 💎 ganadas hoy.`
    : "Día cerrado. No había protogemas nuevas registradas hoy.");
}

async function undoLast() {
  if (!datos.history.length) {
    alert("No hay registros para deshacer.");
    return;
  }

  const last = datos.history[datos.history.length - 1];

  // Solo revierte el último registro de saldo, no un cierre automático.
  if (last.note === "Cierre del día") {
    datos.history.pop();
    await save();
    updateUI();
    return;
  }

  const confirmed = confirm(
    `¿Deshacer el último registro de ${last.delta >= 0 ? "+" : ""}${last.delta} protogemas?`
  );
  if (!confirmed) return;

  if (last.delta > 0) {
    datos.earnedToday = Math.max(0, datos.earnedToday - last.delta);
    datos.totalEarned = Math.max(0, datos.totalEarned - last.delta);
  }

  datos.protos = Math.max(0, datos.protos - last.delta);
  datos.history.pop();

  await save();
  updateUI();
}

function exportData() {
  const blob = new Blob([JSON.stringify(datos, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `genshin-tracker-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const imported = normalizeData(JSON.parse(reader.result));

      if (!confirm("Esto reemplazará los datos actuales por el respaldo importado. ¿Continuar?")) {
        return;
      }

      datos = imported;
      await save();
      updateUI();
      alert("Datos importados correctamente.");
    } catch {
      alert("El archivo no es un respaldo válido.");
    }
  };

  reader.readAsText(file);
}

async function resetData() {
  const ok = confirm(
    "¿Reiniciar todo el tracker? Se borrarán historial, progreso y configuración guardada."
  );
  if (!ok) return;

  datos = structuredClone(DEFAULT_DATA);
  await save();
  updateUI();
}

function bindEvents() {
  document.getElementById("btn-add").addEventListener("click", openAdd);
  document.getElementById("btn-config").addEventListener("click", openConfig);
  document.getElementById("btn-pity").addEventListener("click", openPity);
  document.getElementById("btn-close-day").addEventListener("click", closeDay);
  document.getElementById("btn-undo").addEventListener("click", undoLast);
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("btn-reset").addEventListener("click", resetData);

  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) importData(file);
    e.target.value = "";
  });

  document.getElementById("input-protos").addEventListener("input", previewDelta);
  document.getElementById("save-add").addEventListener("click", saveAdd);
  document.getElementById("save-config").addEventListener("click", saveConfig);
  document.getElementById("save-pity").addEventListener("click", savePity);

  document.querySelectorAll(".close-modal").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.modal));
  });

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal(modal.id);
    });
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal.active").forEach(m => closeModal(m.id));
    }
  });
}

init();
