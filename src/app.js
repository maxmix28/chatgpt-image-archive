const APP_VERSION = "0.3.1";
const DB_NAME = "chatgptImageArchiveDb";
const DB_VERSION = 1;
const DEFAULT_SUPABASE_URL = "https://qkuzbwnchfxauvjktfzm.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_NMhWMg9viA3hZ3mE9IDWoA_mJDS0ryd";
const SUPABASE_BUCKET = "archive-images";
const SUPABASE_JS_URL = "https://esm.sh/@supabase/supabase-js@2";
const STATUSES = [
  ["adopted", "採用"],
  ["pending", "保留"],
  ["failed", "失敗"],
  ["reference", "参考"],
  ["regenerate", "再生成候補"]
];
const REF_TYPES = [
  ["person", "人物参考"],
  ["clothing", "衣装参考"],
  ["composition", "構図参考"],
  ["background", "背景参考"],
  ["other", "その他"]
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $("#app");
const state = {
  db: null,
  route: location.hash.replace(/^#/, "") || "/groups",
  toast: "",
  confirm: null,
  settings: null,
  supabase: null,
  supabaseConfigKey: "",
  syncTimer: null,
  syncing: false,
  syncStatus: "",
  syncError: "",
  syncDetail: "",
  syncDebug: "",
  objectUrls: []
};

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function now() {
  return new Date().toISOString();
}

function fmtDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(value) {
  return STATUSES.find(([key]) => key === value)?.[1] || value || "-";
}

function refTypeLabel(value) {
  return REF_TYPES.find(([key]) => key === value)?.[1] || value || "-";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function splitTags(value = "") {
  return [...new Set(value.split(/[,\s、]+/).map((tag) => tag.trim()).filter(Boolean))];
}

function tagsText(tags = []) {
  return tags.join(", ");
}

function sizeText(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function blobUrl(blob) {
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  return url;
}

async function asWebpBlob(blob) {
  if (blob?.type === "image/webp") return blob;
  return new Blob([await blob.arrayBuffer()], { type: "image/webp" });
}

function cleanupUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      render();
    }
  }, 3200);
}

function askConfirm(title, message, actionLabel = "実行") {
  return new Promise((resolve) => {
    state.confirm = { title, message, actionLabel, resolve };
    render();
  });
}

function closeConfirm(result) {
  const pending = state.confirm;
  state.confirm = null;
  pending?.resolve(result);
  render();
}

function navigate(route) {
  location.hash = route;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("promptGroups")) {
        const groups = db.createObjectStore("promptGroups", { keyPath: "id" });
        groups.createIndex("category", "category");
        groups.createIndex("favorite", "favorite");
        groups.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains("generatedImages")) {
        const images = db.createObjectStore("generatedImages", { keyPath: "id" });
        images.createIndex("groupId", "groupId");
        images.createIndex("status", "status");
        images.createIndex("favorite", "favorite");
        images.createIndex("hash", "hash");
      }
      if (!db.objectStoreNames.contains("referenceImages")) {
        const refs = db.createObjectStore("referenceImages", { keyPath: "id" });
        refs.createIndex("groupId", "groupId");
        refs.createIndex("type", "type");
        refs.createIndex("hash", "hash");
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(storeNames, mode = "readonly") {
  return state.db.transaction(storeNames, mode);
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function all(storeName) {
  return req(tx([storeName]).objectStore(storeName).getAll());
}

function get(storeName, id) {
  return req(tx([storeName]).objectStore(storeName).get(id));
}

function put(storeName, value, transaction = null) {
  const store = transaction ? transaction.objectStore(storeName) : tx([storeName], "readwrite").objectStore(storeName);
  return req(store.put(value));
}

function del(storeName, id, transaction = null) {
  const store = transaction ? transaction.objectStore(storeName) : tx([storeName], "readwrite").objectStore(storeName);
  return req(store.delete(id));
}

function clearStore(storeName, transaction = null) {
  const store = transaction ? transaction.objectStore(storeName) : tx([storeName], "readwrite").objectStore(storeName);
  return req(store.clear());
}

async function defaultSettings() {
  const settings = await get("settings", "settings");
  if (settings) {
    const upgraded = {
      supabaseUrl: DEFAULT_SUPABASE_URL,
      supabaseKey: DEFAULT_SUPABASE_KEY,
      autoSync: true,
      lastSyncAt: settings.lastSyncAt || "",
      ...settings,
      appVersion: APP_VERSION
    };
    if (JSON.stringify(upgraded) !== JSON.stringify(settings)) await put("settings", upgraded);
    return upgraded;
  }
  const initial = {
    id: "settings",
    theme: "light",
    thumbnailSize: "medium",
    listMode: "groups",
    lastBackupAt: "",
    lastSyncAt: "",
    supabaseUrl: DEFAULT_SUPABASE_URL,
    supabaseKey: DEFAULT_SUPABASE_KEY,
    autoSync: true,
    appVersion: APP_VERSION
  };
  await put("settings", initial);
  return initial;
}

async function migrateLegacyStoredImages() {
  const storeNames = ["generatedImages", "referenceImages"];
  for (const storeName of storeNames) {
    const records = await all(storeName);
    const legacy = records.filter((record) => record.storageMode !== "webp-1024-only");
    if (!legacy.length) continue;
    const transaction = tx([storeName], "readwrite");
    for (const record of legacy) {
      const archiveBlob = await asWebpBlob(record.thumbnailBlob || record.blob);
      let width = record.width;
      let height = record.height;
      try {
        const image = await loadImage(archiveBlob);
        width = image.width;
        height = image.height;
      } catch {
        // Keep previous dimensions if the legacy thumbnail cannot be measured.
      }
      await put(storeName, {
        ...record,
        blob: archiveBlob,
        thumbnailBlob: archiveBlob,
        width,
        height,
        originalWidth: record.originalWidth || record.width,
        originalHeight: record.originalHeight || record.height,
        originalFileType: record.originalFileType || record.fileType,
        fileType: archiveBlob.type || "image/webp",
        storageMode: "webp-1024-only"
      }, transaction);
    }
  }
}

async function updateSettings(patch) {
  state.settings = { ...(await defaultSettings()), ...patch, appVersion: APP_VERSION };
  await put("settings", state.settings);
  document.documentElement.dataset.theme = state.settings.theme;
  if ("supabaseUrl" in patch || "supabaseKey" in patch) {
    state.supabase = null;
    state.supabaseConfigKey = "";
  }
  render();
}

async function fileHash(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = url;
  });
}

async function getSupabaseClient() {
  const settings = await defaultSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) throw new Error("Supabase URLとPublishable keyを設定してください。");
  const configKey = `${settings.supabaseUrl}|${settings.supabaseKey}`;
  if (state.supabase && state.supabaseConfigKey === configKey) return state.supabase;
  const { createClient } = await import(SUPABASE_JS_URL);
  state.supabase = createClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  state.supabaseConfigKey = configKey;
  return state.supabase;
}

async function getSupabaseUser() {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Supabaseにログインしてください。");
  return { supabase, user: data.user };
}

function storagePath(userId, kind, id) {
  return `${userId}/${kind}/${id}.webp`;
}

function groupToRow(group, userId) {
  return {
    id: group.id,
    user_id: userId,
    title: group.title || "",
    prompt: group.prompt || "",
    negative_prompt: group.negativePrompt || "",
    memo: group.memo || "",
    category: group.category || "",
    tags: group.tags || [],
    favorite: Boolean(group.favorite),
    created_at: group.createdAt || now(),
    registered_at: group.registeredAt || now(),
    updated_at: group.updatedAt || now(),
    representative_image_id: group.representativeImageId || null,
    deleted_at: null
  };
}

function rowToGroup(row) {
  return {
    id: row.id,
    title: row.title || "",
    prompt: row.prompt || "",
    negativePrompt: row.negative_prompt || "",
    memo: row.memo || "",
    category: row.category || "",
    tags: row.tags || [],
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
    representativeImageId: row.representative_image_id || undefined
  };
}

function generatedToRow(image, userId) {
  return {
    id: image.id,
    user_id: userId,
    group_id: image.groupId,
    title: image.title || "",
    memo: image.memo || "",
    tags: image.tags || [],
    status: image.status || "pending",
    favorite: Boolean(image.favorite),
    rating: Number(image.rating || 0),
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    file_type: "image/webp",
    hash: image.hash || "",
    storage_path: storagePath(userId, "generated", image.id),
    storage_mode: "webp-1024-only",
    original_width: image.originalWidth || null,
    original_height: image.originalHeight || null,
    original_file_type: image.originalFileType || "",
    registered_at: image.registeredAt || now(),
    updated_at: image.updatedAt || now(),
    deleted_at: null
  };
}

function rowToGenerated(row, blob) {
  const webpBlob = blob.type === "image/webp" ? blob : new Blob([blob], { type: "image/webp" });
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title || "",
    memo: row.memo || "",
    tags: row.tags || [],
    status: row.status || "pending",
    favorite: Boolean(row.favorite),
    rating: Number(row.rating || 0),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    fileType: "image/webp",
    hash: row.hash || "",
    blob: webpBlob,
    thumbnailBlob: webpBlob,
    storageMode: "webp-1024-only",
    originalWidth: row.original_width || undefined,
    originalHeight: row.original_height || undefined,
    originalFileType: row.original_file_type || undefined,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at
  };
}

function referenceToRow(image, userId) {
  return {
    id: image.id,
    user_id: userId,
    group_id: image.groupId,
    type: image.type || "other",
    memo: image.memo || "",
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    file_type: "image/webp",
    hash: image.hash || "",
    storage_path: storagePath(userId, "references", image.id),
    storage_mode: "webp-1024-only",
    original_width: image.originalWidth || null,
    original_height: image.originalHeight || null,
    original_file_type: image.originalFileType || "",
    registered_at: image.registeredAt || now(),
    deleted_at: null
  };
}

function rowToReference(row, blob) {
  const webpBlob = blob.type === "image/webp" ? blob : new Blob([blob], { type: "image/webp" });
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.type || "other",
    memo: row.memo || "",
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    fileType: "image/webp",
    hash: row.hash || "",
    blob: webpBlob,
    thumbnailBlob: webpBlob,
    storageMode: "webp-1024-only",
    originalWidth: row.original_width || undefined,
    originalHeight: row.original_height || undefined,
    originalFileType: row.original_file_type || undefined,
    registeredAt: row.registered_at
  };
}

async function uploadImageBlob(supabase, path, blob) {
  const webpBlob = await asWebpBlob(blob);
  const webpFile = new File([webpBlob], path.split("/").pop() || "image.webp", { type: "image/webp" });
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(path, webpFile, {
    cacheControl: "3600",
    contentType: "image/webp",
    upsert: true
  });
  if (error) throw error;
}

async function downloadImageBlob(supabase, path) {
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(path);
  if (error) throw error;
  return data;
}

async function cloudSignUp(email, password) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

async function cloudSignIn(email, password) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await syncFromCloud({ force: true, replace: true });
}

async function cloudSignOut() {
  const supabase = await getSupabaseClient();
  await supabase.auth.signOut();
  state.syncStatus = "";
  render();
}

async function syncToCloud() {
  if (state.syncing) return false;
  state.syncing = true;
  state.syncStatus = "同期中";
  state.syncError = "";
  state.syncDetail = "";
  try {
    const { supabase, user } = await getSupabaseUser();
    const [groups, generatedImages, referenceImages] = await Promise.all([all("promptGroups"), all("generatedImages"), all("referenceImages")]);
    await Promise.all(generatedImages.map((image) => uploadImageBlob(supabase, storagePath(user.id, "generated", image.id), image.blob)));
    await Promise.all(referenceImages.map((image) => uploadImageBlob(supabase, storagePath(user.id, "references", image.id), image.blob)));
    if (groups.length) {
      const { error } = await supabase.from("prompt_groups").upsert(groups.map((group) => groupToRow(group, user.id)));
      if (error) throw error;
    }
    if (generatedImages.length) {
      const { error } = await supabase.from("generated_images").upsert(generatedImages.map((image) => generatedToRow(image, user.id)));
      if (error) throw error;
    }
    if (referenceImages.length) {
      const { error } = await supabase.from("reference_images").upsert(referenceImages.map((image) => referenceToRow(image, user.id)));
      if (error) throw error;
    }
    await updateSettings({ lastSyncAt: now() });
    state.syncStatus = `同期済み: グループ${groups.length}件 / 生成画像${generatedImages.length}枚 / 参考画像${referenceImages.length}枚`;
    state.syncDetail = `アップロード先ユーザーID: ${user.id}`;
    return true;
  } catch (error) {
    state.syncStatus = "同期失敗";
    state.syncError = error.message || "Supabase同期に失敗しました。";
    toast(state.syncError);
    return false;
  } finally {
    state.syncing = false;
  }
}

async function syncFromCloud(options = {}) {
  if (state.syncing && !options.force) return false;
  if (options.force) {
    clearTimeout(state.syncTimer);
    state.syncing = false;
  }
  state.syncing = true;
  state.syncStatus = "取得中";
  state.syncError = "";
  state.syncDetail = "";
  try {
    const { supabase, user } = await getSupabaseUser();
    const [groupsResult, generatedResult, refsResult] = await Promise.all([
      supabase.from("prompt_groups").select("*").is("deleted_at", null),
      supabase.from("generated_images").select("*").is("deleted_at", null),
      supabase.from("reference_images").select("*").is("deleted_at", null)
    ]);
    if (groupsResult.error) throw groupsResult.error;
    if (generatedResult.error) throw generatedResult.error;
    if (refsResult.error) throw refsResult.error;
    const cloudGroups = groupsResult.data.map((row) => rowToGroup(row));
    const cloudImages = [];
    const cloudRefs = [];
    for (const row of generatedResult.data) {
      const blob = await downloadImageBlob(supabase, row.storage_path);
      cloudImages.push(rowToGenerated(row, blob));
    }
    for (const row of refsResult.data) {
      const blob = await downloadImageBlob(supabase, row.storage_path);
      cloudRefs.push(rowToReference(row, blob));
    }
    if (options.replace) {
      await clearStore("generatedImages");
      await clearStore("referenceImages");
      await clearStore("promptGroups");
    }
    await Promise.all(cloudGroups.map((group) => put("promptGroups", group)));
    await Promise.all(cloudImages.map((image) => put("generatedImages", image)));
    await Promise.all(cloudRefs.map((ref) => put("referenceImages", ref)));
    await updateSettings({ lastSyncAt: now() });
    const [localGroups, localImages, localRefs] = await Promise.all([all("promptGroups"), all("generatedImages"), all("referenceImages")]);
    state.syncStatus = `取得済み: クラウド グループ${groupsResult.data.length}件 / 端末 グループ${localGroups.length}件`;
    state.syncDetail = `取得元ユーザーID: ${user.id} / 生成画像 ${generatedResult.data.length}→${localImages.length}枚 / 参考画像 ${refsResult.data.length}→${localRefs.length}枚`;
    return true;
  } catch (error) {
    state.syncStatus = "取得失敗";
    state.syncError = error.message || "Supabaseからの取得に失敗しました。";
    toast(state.syncError);
    return false;
  } finally {
    state.syncing = false;
  }
}

async function runCloudDiagnostics() {
  state.syncError = "";
  state.syncDebug = "";
  try {
    const settings = await defaultSettings();
    const { supabase, user } = await getSupabaseUser();
    const { data, error } = await supabase
      .from("prompt_groups")
      .select("id,title,updated_at,registered_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const lines = (data || []).map((row, index) =>
      `${index + 1}. ${row.updated_at || row.registered_at || "-"} / ${row.id} / ${row.title || "無題"}`
    );
    state.syncDebug = [
      `Project URL: ${settings.supabaseUrl}`,
      `Email: ${user.email || "-"}`,
      `User ID: ${user.id}`,
      `Cloud groups: ${data?.length || 0}`,
      ...lines
    ].join("\n");
    state.syncStatus = `診断完了: クラウド グループ${data?.length || 0}件`;
    return true;
  } catch (error) {
    state.syncStatus = "診断失敗";
    state.syncError = error.message || "同期診断に失敗しました。";
    toast(state.syncError);
    return false;
  }
}

function scheduleCloudSync(delay = 1200) {
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    const settings = await defaultSettings();
    if (!settings.autoSync) return;
    const supabase = await getSupabaseClient().catch(() => null);
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await syncToCloud();
  }, delay);
}

async function deleteRemoteGenerated(image) {
  const { supabase, user } = await getSupabaseUser();
  await supabase.from("generated_images").delete().eq("id", image.id);
  await supabase.storage.from(SUPABASE_BUCKET).remove([storagePath(user.id, "generated", image.id)]);
}

async function deleteRemoteReference(ref) {
  const { supabase, user } = await getSupabaseUser();
  await supabase.from("reference_images").delete().eq("id", ref.id);
  await supabase.storage.from(SUPABASE_BUCKET).remove([storagePath(user.id, "references", ref.id)]);
}

async function deleteRemoteGroup(group, images, refs) {
  const { supabase, user } = await getSupabaseUser();
  await supabase.storage.from(SUPABASE_BUCKET).remove([
    ...images.map((image) => storagePath(user.id, "generated", image.id)),
    ...refs.map((ref) => storagePath(user.id, "references", ref.id))
  ]);
  await supabase.from("prompt_groups").delete().eq("id", group.id);
}

async function makeArchiveImage(file) {
  const image = await loadImage(file);
  const scale = Math.min(1024 / image.width, 1024 / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  const archiveBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
  if (!archiveBlob) throw new Error("WebP画像の作成に失敗しました。");
  return {
    archiveBlob,
    width,
    height,
    originalWidth: image.width,
    originalHeight: image.height,
    originalFileType: file.type
  };
}

async function prepareImage(file, groupId, kind) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error(`${file.name} は対応外の画像形式です。`);
  const { archiveBlob, width, height, originalWidth, originalHeight, originalFileType } = await makeArchiveImage(file);
  const hash = await fileHash(archiveBlob);
  const id = uid(kind === "generated" ? "img" : "ref");
  return {
    id,
    groupId,
    width,
    height,
    originalWidth,
    originalHeight,
    originalFileType,
    fileType: "image/webp",
    hash,
    blob: archiveBlob,
    thumbnailBlob: archiveBlob,
    storageMode: "webp-1024-only",
    registeredAt: now()
  };
}

async function duplicateWarnings(items) {
  const existing = [...await all("generatedImages"), ...await all("referenceImages")];
  const hits = items.filter((item) => existing.some((saved) => saved.hash === item.hash));
  if (!hits.length) return true;
  return askConfirm("重複画像の確認", `${hits.length}枚の画像が既存データと完全一致しています。続行して登録しますか？`, "続行");
}

async function createGroupFromForm(form) {
  const generatedFiles = [...form.generated.files];
  const referenceFiles = [...form.references.files];
  const prompt = form.prompt.value.trim();
  if (!prompt) throw new Error("プロンプト本文を入力してください。");
  if (!generatedFiles.length) throw new Error("生成画像を1枚以上選択してください。");
  const date = now();
  const groupId = uid("grp");
  const title = form.title.value.trim() || `${prompt.slice(0, 32)}${prompt.length > 32 ? "..." : ""}` || `新規グループ ${fmtDate(date)}`;
  const generated = await Promise.all(generatedFiles.map(async (file) => ({
    ...await prepareImage(file, groupId, "generated"),
    title: file.name.replace(/\.[^.]+$/, ""),
    memo: "",
    tags: [],
    status: "pending",
    favorite: false,
    rating: 0,
    updatedAt: date
  })));
  const references = await Promise.all(referenceFiles.map(async (file) => ({
    ...await prepareImage(file, groupId, "reference"),
    type: "other",
    memo: ""
  })));
  if (!await duplicateWarnings([...generated, ...references])) return;
  const group = {
    id: groupId,
    title,
    prompt,
    negativePrompt: form.negativePrompt.value.trim(),
    memo: form.memo.value.trim(),
    category: form.category.value.trim(),
    tags: splitTags(form.tags.value),
    favorite: false,
    createdAt: form.createdAt.value ? new Date(form.createdAt.value).toISOString() : date,
    registeredAt: date,
    updatedAt: date,
    representativeImageId: generated[0]?.id
  };
  const transaction = tx(["promptGroups", "generatedImages", "referenceImages"], "readwrite");
  await put("promptGroups", group, transaction);
  await Promise.all(generated.map((image) => put("generatedImages", image, transaction)));
  await Promise.all(references.map((image) => put("referenceImages", image, transaction)));
  scheduleCloudSync(0);
  toast("グループを登録しました。");
  navigate(`/group/${groupId}`);
}

async function addFilesToGroup(groupId, files, kind) {
  if (!files.length) return;
  const prepared = await Promise.all(files.map((file) => prepareImage(file, groupId, kind)));
  if (!await duplicateWarnings(prepared)) return;
  const date = now();
  const group = await get("promptGroups", groupId);
  const storeName = kind === "generated" ? "generatedImages" : "referenceImages";
  const records = prepared.map((item) => kind === "generated" ? {
    ...item,
    title: "",
    memo: "",
    tags: [],
    status: "pending",
    favorite: false,
    rating: 0,
    updatedAt: date
  } : {
    ...item,
    type: "other",
    memo: ""
  });
  const transaction = tx(["promptGroups", storeName], "readwrite");
  await Promise.all(records.map((record) => put(storeName, record, transaction)));
  await put("promptGroups", {
    ...group,
    representativeImageId: group.representativeImageId || records[0]?.id,
    updatedAt: date
  }, transaction);
  scheduleCloudSync(0);
  toast(kind === "generated" ? "生成画像を追加しました。" : "参考画像を追加しました。");
  render();
}

async function imagesForGroup(groupId) {
  const images = await all("generatedImages");
  return images.filter((image) => image.groupId === groupId);
}

async function refsForGroup(groupId) {
  const refs = await all("referenceImages");
  return refs.filter((image) => image.groupId === groupId);
}

function filtersFromDom() {
  return {
    q: $("#q")?.value.trim().toLowerCase() || "",
    tag: $("#tag")?.value.trim().toLowerCase() || "",
    category: $("#category")?.value.trim() || "",
    favorite: $("#favorite")?.checked || false,
    status: $("#status")?.value || "",
    hasImages: $("#hasImages")?.value || "",
    hasRefs: $("#hasRefs")?.value || "",
    sort: $("#sort")?.value || "updatedDesc"
  };
}

function searchTextGroup(group, images) {
  return [
    group.title,
    group.prompt,
    group.negativePrompt,
    group.memo,
    group.category,
    ...(group.tags || []),
    ...images.flatMap((image) => [image.title, image.memo, ...(image.tags || [])])
  ].join(" ").toLowerCase();
}

async function getGroupCards() {
  const [groups, allImages, allRefs] = await Promise.all([all("promptGroups"), all("generatedImages"), all("referenceImages")]);
  return groups.map((group) => {
    const images = allImages.filter((image) => image.groupId === group.id);
    const refs = allRefs.filter((image) => image.groupId === group.id);
    const representative = allImages.find((image) => image.id === group.representativeImageId) || images[0];
    return { group, images, refs, representative };
  });
}

function sortGroupCards(cards, sort) {
  const byDate = (key) => (a, b) => String(b.group[key] || "").localeCompare(String(a.group[key] || ""));
  const sorters = {
    registeredDesc: (a, b) => String(b.group.registeredAt).localeCompare(a.group.registeredAt),
    registeredAsc: (a, b) => String(a.group.registeredAt).localeCompare(b.group.registeredAt),
    updatedDesc: byDate("updatedAt"),
    createdDesc: byDate("createdAt"),
    ratingDesc: (a, b) => Math.max(0, ...b.images.map((x) => x.rating || 0)) - Math.max(0, ...a.images.map((x) => x.rating || 0)),
    imageCountDesc: (a, b) => b.images.length - a.images.length,
    favoriteFirst: (a, b) => Number(b.group.favorite || b.images.some((x) => x.favorite)) - Number(a.group.favorite || a.images.some((x) => x.favorite))
  };
  return cards.sort(sorters[sort] || sorters.updatedDesc);
}

function applyGroupFilters(cards, filters) {
  return sortGroupCards(cards.filter(({ group, images, refs }) => {
    const text = searchTextGroup(group, images);
    const tags = [...(group.tags || []), ...images.flatMap((image) => image.tags || [])].map((tag) => tag.toLowerCase());
    const statuses = images.map((image) => image.status);
    if (filters.q && !text.includes(filters.q)) return false;
    if (filters.tag && !tags.includes(filters.tag)) return false;
    if (filters.category && group.category !== filters.category) return false;
    if (filters.favorite && !group.favorite && !images.some((image) => image.favorite)) return false;
    if (filters.status && !statuses.includes(filters.status)) return false;
    if (filters.hasImages === "yes" && !images.length) return false;
    if (filters.hasImages === "no" && images.length) return false;
    if (filters.hasRefs === "yes" && !refs.length) return false;
    if (filters.hasRefs === "no" && refs.length) return false;
    return true;
  }), filters.sort);
}

async function renderLayout(body) {
  const nav = [
    ["/groups", "グループ"],
    ["/images", "画像一覧"],
    ["/new", "新規登録"],
    ["/settings", "設定"]
  ];
  const route = state.route;
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">IA</div>
          <div>
            <h1>ChatGPT Image Archive</h1>
            <p>プロンプト単位で保存するローカル画像アーカイブ / v${APP_VERSION}</p>
          </div>
        </div>
        <nav class="nav">${nav.map(([href, label]) => `<button class="${route.startsWith(href) ? "active" : ""}" data-nav="${href}">${label}</button>`).join("")}</nav>
      </header>
      <main class="content">${body}</main>
      <nav class="bottom-nav">${nav.map(([href, label]) => `<button class="${route.startsWith(href) ? "active" : ""}" data-nav="${href}">${label}</button>`).join("")}</nav>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
      ${state.confirm ? `<div class="modal-backdrop">
        <div class="modal">
          <h3>${escapeHtml(state.confirm.title)}</h3>
          <p>${escapeHtml(state.confirm.message)}</p>
          <div class="row-actions">
            <button data-confirm="cancel">キャンセル</button>
            <button class="primary" data-confirm="ok">${escapeHtml(state.confirm.actionLabel)}</button>
          </div>
        </div>
      </div>` : ""}
    </div>
  `;
  $$("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  $$("[data-confirm]").forEach((button) => button.addEventListener("click", () => closeConfirm(button.dataset.confirm === "ok")));
}

function filterHtml({ categories, tags, includeStatus = true } = {}) {
  return `
    <div class="toolbar">
      <div class="field"><label for="q">キーワード</label><input id="q" placeholder="タイトル、プロンプト、メモを検索"></div>
      <div class="field"><label for="tag">タグ</label><input id="tag" list="tagList" placeholder="完全一致"><datalist id="tagList">${(tags || []).map((tag) => `<option value="${escapeHtml(tag)}"></option>`).join("")}</datalist></div>
      <div class="field"><label for="category">カテゴリ</label><select id="category"><option value="">すべて</option>${(categories || []).map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("")}</select></div>
      ${includeStatus ? `<div class="field"><label for="status">ステータス</label><select id="status"><option value="">すべて</option>${STATUSES.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="sort">並び替え</label><select id="sort">
        <option value="updatedDesc">更新日順</option>
        <option value="registeredDesc">登録日 新しい順</option>
        <option value="registeredAsc">登録日 古い順</option>
        <option value="createdDesc">作成日順</option>
        <option value="ratingDesc">評価順</option>
        <option value="imageCountDesc">画像数順</option>
        <option value="favoriteFirst">お気に入り優先</option>
      </select></div>
      <div class="field"><label>お気に入り</label><label><input id="favorite" type="checkbox"> のみ表示</label></div>
    </div>
  `;
}

async function renderGroupList() {
  const cards = await getGroupCards();
  const categories = [...new Set(cards.map(({ group }) => group.category).filter(Boolean))].sort();
  const tags = [...new Set(cards.flatMap(({ group, images }) => [...(group.tags || []), ...images.flatMap((image) => image.tags || [])]))].sort();
  const body = `
    <section class="page-head">
      <div><h2>グループ一覧</h2><p>1つのプロンプトを1グループとして管理します。</p></div>
      <button class="primary" data-nav="/new">新規登録</button>
    </section>
    ${filterHtml({ categories, tags })}
    <div class="row-actions" style="margin-bottom:1rem">
      <div class="field"><label for="hasImages">生成画像</label><select id="hasImages"><option value="">すべて</option><option value="yes">あり</option><option value="no">なし</option></select></div>
      <div class="field"><label for="hasRefs">参考画像</label><select id="hasRefs"><option value="">すべて</option><option value="yes">あり</option><option value="no">なし</option></select></div>
    </div>
    <div id="groupGrid"></div>
  `;
  await renderLayout(body);
  const update = () => {
    const filtered = applyGroupFilters(cards, filtersFromDom());
    $("#groupGrid").innerHTML = filtered.length ? `<div class="grid">${filtered.map(groupCardHtml).join("")}</div>` : `<div class="panel pad">該当するグループはありません。</div>`;
    $$("[data-group]").forEach((el) => el.addEventListener("click", () => navigate(`/group/${el.dataset.group}`)));
    $$("[data-toggle-group-fav]").forEach((el) => el.addEventListener("click", async (event) => {
      event.stopPropagation();
      const group = await get("promptGroups", el.dataset.toggleGroupFav);
      await put("promptGroups", { ...group, favorite: !group.favorite, updatedAt: now() });
      scheduleCloudSync(0);
      render();
    }));
  };
  ["q", "tag", "category", "favorite", "status", "sort", "hasImages", "hasRefs"].forEach((id) => $(`#${id}`)?.addEventListener("input", update));
  update();
}

function groupCardHtml({ group, images, refs, representative }) {
  return `
    <article class="card" data-group="${group.id}">
      ${representative ? `<img class="card-thumb" src="${blobUrl(representative.thumbnailBlob)}" alt="">` : `<div class="empty-thumb">No Image</div>`}
      <div class="card-body">
        <div class="card-title">${escapeHtml(group.title)}</div>
        <div class="meta"><span>${images.length}枚</span><span>参考 ${refs.length}枚</span><span>${escapeHtml(group.category || "カテゴリなし")}</span></div>
        <div class="chips">${(group.tags || []).slice(0, 6).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="row-actions">
          <button data-toggle-group-fav="${group.id}" title="お気に入り">${group.favorite ? "★" : "☆"}</button>
          <span class="meta">${fmtDate(group.updatedAt)}</span>
        </div>
      </div>
    </article>
  `;
}

async function renderImageList() {
  const [images, groups] = await Promise.all([all("generatedImages"), all("promptGroups")]);
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const tags = [...new Set(images.flatMap((image) => image.tags || []))].sort();
  const body = `
    <section class="page-head">
      <div><h2>画像一覧</h2><p>全グループの生成画像を横断して確認します。</p></div>
      <button class="primary" data-nav="/new">新規登録</button>
    </section>
    ${filterHtml({ categories: [], tags })}
    <div id="imageGrid"></div>
  `;
  await renderLayout(body);
  $("#category").closest(".field").style.display = "none";
  const update = () => {
    const filters = filtersFromDom();
    let list = images.filter((image) => {
      const group = groupMap.get(image.groupId) || {};
      const text = [image.title, image.memo, ...(image.tags || []), group.title, group.prompt, group.category].join(" ").toLowerCase();
      if (filters.q && !text.includes(filters.q)) return false;
      if (filters.tag && !(image.tags || []).map((tag) => tag.toLowerCase()).includes(filters.tag)) return false;
      if (filters.favorite && !image.favorite) return false;
      if (filters.status && image.status !== filters.status) return false;
      return true;
    });
    list = list.sort((a, b) => {
      if (filters.sort === "ratingDesc") return (b.rating || 0) - (a.rating || 0);
      if (filters.sort === "favoriteFirst") return Number(b.favorite) - Number(a.favorite);
      if (filters.sort === "registeredAsc") return String(a.registeredAt).localeCompare(String(b.registeredAt));
      return String(b.updatedAt || b.registeredAt).localeCompare(String(a.updatedAt || a.registeredAt));
    });
    $("#imageGrid").innerHTML = list.length ? `<div class="grid">${list.map((image) => imageCardHtml(image, groupMap.get(image.groupId))).join("")}</div>` : `<div class="panel pad">該当する画像はありません。</div>`;
    $$("[data-image]").forEach((el) => el.addEventListener("click", () => navigate(`/image/${el.dataset.image}`)));
  };
  ["q", "tag", "favorite", "status", "sort"].forEach((id) => $(`#${id}`)?.addEventListener("input", update));
  update();
}

function imageCardHtml(image, group) {
  return `
    <article class="card" data-image="${image.id}">
      <img class="card-thumb" src="${blobUrl(image.thumbnailBlob)}" alt="">
      <div class="card-body">
        <div class="card-title">${escapeHtml(image.title || "無題の画像")}</div>
        <div class="meta"><span>${escapeHtml(group?.title || "所属不明")}</span><span class="chip status">${statusLabel(image.status)}</span></div>
        <div class="chips">${(image.tags || []).slice(0, 6).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="meta">${image.favorite ? "★ " : ""}評価 ${image.rating || 0} / 5</div>
      </div>
    </article>
  `;
}

async function renderNewGroup() {
  await renderLayout(`
    <section class="page-head">
      <div><h2>新規登録</h2><p>1つのプロンプトに複数の生成画像と参考画像をまとめて登録します。</p></div>
    </section>
    <form id="newForm" class="form-grid">
      <div class="stack">
        <div class="panel pad stack">
          <div class="field"><label for="title">グループタイトル</label><input id="title" name="title" placeholder="未入力時は自動生成"></div>
          <div class="field"><label for="prompt">プロンプト本文 *</label><textarea id="prompt" name="prompt" required></textarea></div>
          <div class="field"><label for="negativePrompt">ネガティブプロンプト</label><textarea id="negativePrompt" name="negativePrompt"></textarea></div>
          <div class="field"><label for="memo">メモ</label><textarea id="memo" name="memo"></textarea></div>
        </div>
      </div>
      <div class="stack">
        <div class="panel pad stack">
          <div class="field"><label for="category">カテゴリ</label><input id="category" name="category"></div>
          <div class="field"><label for="tags">タグ</label><input id="tags" name="tags" placeholder="カンマ、空白、読点で区切る"></div>
          <div class="field"><label for="createdAt">作成日</label><input id="createdAt" name="createdAt" type="datetime-local"></div>
          ${fileFieldHtml("generated", "生成画像 *", true)}
          ${fileFieldHtml("references", "参考画像", true)}
          <button class="primary" type="submit">保存</button>
        </div>
      </div>
    </form>
  `);
  wireFilePreview("generated");
  wireFilePreview("references");
  $("#newForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createGroupFromForm(event.currentTarget);
    } catch (error) {
      toast(error.message || "登録に失敗しました。");
    }
  });
}

function fileFieldHtml(name, label, multiple) {
  return `
    <div class="field drop-zone" data-drop="${name}">
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${multiple ? "multiple" : ""}>
      <span class="hint">ファイル選択、ドラッグ＆ドロップ、画像貼り付けに対応</span>
      <div class="preview-list" id="${name}Preview"></div>
    </div>
  `;
}

function wireFilePreview(name) {
  const input = $(`#${name}`);
  const zone = $(`[data-drop="${name}"]`);
  const preview = $(`#${name}Preview`);
  const update = () => {
    const files = [...input.files];
    preview.innerHTML = files.map((file, index) => `
      <div class="preview-item">
        <img src="${blobUrl(file)}" alt="">
        <div><strong>${escapeHtml(file.name)}</strong><div class="meta">${sizeText(file.size)} / ${escapeHtml(file.type)}</div></div>
        <span>${index + 1}</span>
      </div>
    `).join("");
  };
  input.addEventListener("change", update);
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("drag");
    input.files = event.dataTransfer.files;
    update();
  });
  document.addEventListener("paste", (event) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (!files.length || state.route !== "/new") return;
    const dt = new DataTransfer();
    [...input.files, ...files].forEach((file) => dt.items.add(file));
    input.files = dt.files;
    update();
  });
}

async function renderGroupDetail(groupId) {
  const [group, images, refs] = await Promise.all([get("promptGroups", groupId), imagesForGroup(groupId), refsForGroup(groupId)]);
  if (!group) {
    await renderLayout(`<div class="panel pad">グループが見つかりません。</div>`);
    return;
  }
  await renderLayout(`
    <section class="page-head">
      <div><h2>${escapeHtml(group.title)}</h2><p>${escapeHtml(group.category || "カテゴリなし")} / 更新 ${fmtDate(group.updatedAt)}</p></div>
      <div class="row-actions">
        <button data-copy-prompt>プロンプトをコピー</button>
        <button data-edit-group>編集</button>
        <button data-fav-group>${group.favorite ? "★" : "☆"}</button>
        <button class="danger" data-delete-group>削除</button>
      </div>
    </section>
    <div class="detail-grid">
      <section class="panel pad stack">
        <h3>プロンプト</h3>
        <div class="prompt-box">${escapeHtml(group.prompt)}</div>
        ${group.negativePrompt ? `<h3>ネガティブプロンプト</h3><div class="prompt-box">${escapeHtml(group.negativePrompt)}</div>` : ""}
        ${group.memo ? `<h3>メモ</h3><div class="prompt-box">${escapeHtml(group.memo)}</div>` : ""}
        <div class="chips">${(group.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
      </section>
      <section class="stack">
        <div class="panel pad stack">
          <div class="page-head"><div><h3>生成画像</h3><p>${images.length}枚</p></div><label><input id="addGenerated" type="file" accept="image/*" multiple class="sr-only"><button id="addGeneratedBtn">画像追加</button></label></div>
          <div class="grid">${images.map((image) => imageCardHtml(image, group)).join("") || "生成画像がありません。"}</div>
        </div>
        <div class="panel pad stack">
          <div class="page-head"><div><h3>参考画像</h3><p>${refs.length}枚</p></div><label><input id="addRefs" type="file" accept="image/*" multiple class="sr-only"><button id="addRefsBtn">参考追加</button></label></div>
          <div class="grid">${refs.map(refCardHtml).join("") || "参考画像はありません。"}</div>
        </div>
      </section>
    </div>
  `);
  $("[data-copy-prompt]").addEventListener("click", async () => {
    await navigator.clipboard.writeText(group.prompt);
    toast("プロンプトをコピーしました。");
  });
  $("[data-edit-group]").addEventListener("click", () => renderGroupEdit(groupId));
  $("[data-fav-group]").addEventListener("click", async () => {
    await put("promptGroups", { ...group, favorite: !group.favorite, updatedAt: now() });
    scheduleCloudSync(0);
    render();
  });
  $("[data-delete-group]").addEventListener("click", async () => {
    if (!await askConfirm("グループ削除", "グループと所属する画像、参考画像を完全に削除します。", "削除")) return;
    await deleteRemoteGroup(group, images, refs).catch(() => {});
    const transaction = tx(["promptGroups", "generatedImages", "referenceImages"], "readwrite");
    await Promise.all(images.map((image) => del("generatedImages", image.id, transaction)));
    await Promise.all(refs.map((ref) => del("referenceImages", ref.id, transaction)));
    await del("promptGroups", groupId, transaction);
    toast("グループを削除しました。");
    navigate("/groups");
  });
  $("#addGeneratedBtn").addEventListener("click", () => $("#addGenerated").click());
  $("#addRefsBtn").addEventListener("click", () => $("#addRefs").click());
  $("#addGenerated").addEventListener("change", (event) => addFilesToGroup(groupId, [...event.target.files], "generated"));
  $("#addRefs").addEventListener("change", (event) => addFilesToGroup(groupId, [...event.target.files], "reference"));
  $$("[data-image]").forEach((el) => el.addEventListener("click", () => navigate(`/image/${el.dataset.image}`)));
  $$("[data-delete-ref]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!await askConfirm("参考画像削除", "この参考画像を削除します。", "削除")) return;
    const ref = await get("referenceImages", button.dataset.deleteRef);
    if (ref) await deleteRemoteReference(ref).catch(() => {});
    await del("referenceImages", button.dataset.deleteRef);
    scheduleCloudSync(0);
    toast("参考画像を削除しました。");
    render();
  }));
}

function refCardHtml(ref) {
  return `
    <article class="card">
      <img class="card-thumb" src="${blobUrl(ref.thumbnailBlob)}" alt="">
      <div class="card-body">
        <div class="card-title">${refTypeLabel(ref.type)}</div>
        <div class="meta">${ref.width} x ${ref.height} / ${escapeHtml(ref.fileType)}</div>
        ${ref.memo ? `<div>${escapeHtml(ref.memo)}</div>` : ""}
        <button class="danger" data-delete-ref="${ref.id}">削除</button>
      </div>
    </article>
  `;
}

async function renderGroupEdit(groupId) {
  const group = await get("promptGroups", groupId);
  await renderLayout(`
    <section class="page-head"><div><h2>グループ編集</h2><p>${escapeHtml(group.title)}</p></div></section>
    <form id="editGroupForm" class="panel pad stack">
      <div class="field"><label>タイトル</label><input name="title" value="${escapeHtml(group.title)}"></div>
      <div class="field"><label>プロンプト</label><textarea name="prompt">${escapeHtml(group.prompt)}</textarea></div>
      <div class="field"><label>ネガティブプロンプト</label><textarea name="negativePrompt">${escapeHtml(group.negativePrompt || "")}</textarea></div>
      <div class="field"><label>メモ</label><textarea name="memo">${escapeHtml(group.memo || "")}</textarea></div>
      <div class="field"><label>カテゴリ</label><input name="category" value="${escapeHtml(group.category || "")}"></div>
      <div class="field"><label>タグ</label><input name="tags" value="${escapeHtml(tagsText(group.tags))}"></div>
      <label><input name="favorite" type="checkbox" ${group.favorite ? "checked" : ""}> お気に入り</label>
      <div class="row-actions"><button type="button" data-back>戻る</button><button class="primary">保存</button></div>
    </form>
  `);
  $("[data-back]").addEventListener("click", () => navigate(`/group/${groupId}`));
  $("#editGroupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.prompt.value.trim() && !await askConfirm("空のプロンプト", "プロンプト本文が空です。このまま保存しますか？", "保存")) return;
    await put("promptGroups", {
      ...group,
      title: form.title.value.trim() || group.title,
      prompt: form.prompt.value.trim(),
      negativePrompt: form.negativePrompt.value.trim(),
      memo: form.memo.value.trim(),
      category: form.category.value.trim(),
      tags: splitTags(form.tags.value),
      favorite: form.favorite.checked,
      updatedAt: now()
    });
    scheduleCloudSync(0);
    toast("グループを更新しました。");
    navigate(`/group/${groupId}`);
  });
}

async function renderImageDetail(imageId) {
  const image = await get("generatedImages", imageId);
  const group = image ? await get("promptGroups", image.groupId) : null;
  if (!image || !group) {
    await renderLayout(`<div class="panel pad">画像が見つかりません。</div>`);
    return;
  }
  const refs = await refsForGroup(group.id);
  await renderLayout(`
    <section class="page-head">
      <div><h2>${escapeHtml(image.title || "無題の画像")}</h2><p>${escapeHtml(group.title)} / ${image.width} x ${image.height}</p></div>
      <div class="row-actions">
        <button data-copy-prompt>プロンプトをコピー</button>
        <button data-download>WebP保存</button>
        <button data-edit-image>編集</button>
        <button class="danger" data-delete-image>削除</button>
      </div>
    </section>
    <div class="detail-grid">
      <img class="hero-image" src="${blobUrl(image.blob)}" alt="">
      <section class="panel pad stack">
        <div class="chips"><span class="chip status">${statusLabel(image.status)}</span>${(image.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
        <p><strong>お気に入り:</strong> ${image.favorite ? "はい" : "いいえ"} / <strong>評価:</strong> ${image.rating || 0} / 5</p>
        <p><strong>保存画像:</strong> 最大1024px / WebP / 品質0.8${image.originalWidth ? `（元画像 ${image.originalWidth} x ${image.originalHeight} は保存していません）` : ""}</p>
        ${image.memo ? `<div class="prompt-box">${escapeHtml(image.memo)}</div>` : ""}
        <h3>所属グループのプロンプト</h3>
        <div class="prompt-box">${escapeHtml(group.prompt)}</div>
        <h3>参考画像</h3>
        <div class="grid">${refs.map(refCardHtml).join("") || "参考画像はありません。"}</div>
      </section>
    </div>
  `);
  $("[data-copy-prompt]").addEventListener("click", async () => {
    await navigator.clipboard.writeText(group.prompt);
    toast("プロンプトをコピーしました。");
  });
  $("[data-download]").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = blobUrl(image.blob);
    link.download = `${image.title || image.id}.${extFromMime(image.fileType)}`;
    link.click();
  });
  $("[data-edit-image]").addEventListener("click", () => renderImageEdit(imageId));
  $("[data-delete-image]").addEventListener("click", async () => {
    if (!await askConfirm("画像削除", "この生成画像を削除します。", "削除")) return;
    await deleteRemoteGenerated(image).catch(() => {});
    await del("generatedImages", imageId);
    scheduleCloudSync(0);
    toast("画像を削除しました。");
    navigate(`/group/${group.id}`);
  });
  $$("[data-delete-ref]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!await askConfirm("参考画像削除", "この参考画像を削除します。", "削除")) return;
    const ref = await get("referenceImages", button.dataset.deleteRef);
    if (ref) await deleteRemoteReference(ref).catch(() => {});
    await del("referenceImages", button.dataset.deleteRef);
    scheduleCloudSync(0);
    toast("参考画像を削除しました。");
    render();
  }));
}

async function renderImageEdit(imageId) {
  const image = await get("generatedImages", imageId);
  await renderLayout(`
    <section class="page-head"><div><h2>画像情報編集</h2><p>${escapeHtml(image.title || image.id)}</p></div></section>
    <form id="editImageForm" class="panel pad stack">
      <div class="field"><label>画像タイトル</label><input name="title" value="${escapeHtml(image.title || "")}"></div>
      <div class="field"><label>メモ</label><textarea name="memo">${escapeHtml(image.memo || "")}</textarea></div>
      <div class="field"><label>タグ</label><input name="tags" value="${escapeHtml(tagsText(image.tags))}"></div>
      <div class="field"><label>ステータス</label><select name="status">${STATUSES.map(([key, label]) => `<option value="${key}" ${image.status === key ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="field"><label>評価</label><input name="rating" type="number" min="0" max="5" value="${Number(image.rating || 0)}"></div>
      <label><input name="favorite" type="checkbox" ${image.favorite ? "checked" : ""}> お気に入り</label>
      <div class="row-actions"><button type="button" data-back>戻る</button><button class="primary">保存</button></div>
    </form>
  `);
  $("[data-back]").addEventListener("click", () => navigate(`/image/${imageId}`));
  $("#editImageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await put("generatedImages", {
      ...image,
      title: form.title.value.trim(),
      memo: form.memo.value.trim(),
      tags: splitTags(form.tags.value),
      status: form.status.value,
      rating: Math.max(0, Math.min(5, Number(form.rating.value || 0))),
      favorite: form.favorite.checked,
      updatedAt: now()
    });
    const group = await get("promptGroups", image.groupId);
    await put("promptGroups", { ...group, updatedAt: now() });
    scheduleCloudSync(0);
    toast("画像情報を更新しました。");
    navigate(`/image/${imageId}`);
  });
}

function extFromMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

async function renderSettings() {
  const [groups, images, refs, settings] = await Promise.all([all("promptGroups"), all("generatedImages"), all("referenceImages"), defaultSettings()]);
  let sessionEmail = "";
  try {
    const supabase = await getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    sessionEmail = data.session?.user?.email || "";
  } catch {
    sessionEmail = "";
  }
  const bytes = [...images, ...refs].reduce((sum, image) => sum + (image.blob?.size || 0), 0);
  await renderLayout(`
    <section class="page-head"><div><h2>設定</h2><p>バックアップと表示設定を管理します。</p></div></section>
    <div class="settings-grid">
      <section class="panel pad stack">
        <h3>表示</h3>
        <div class="field"><label>テーマ</label><select id="theme"><option value="light">ライト</option><option value="dark">ダーク</option></select></div>
        <div class="field"><label>サムネイルサイズ</label><select id="thumbnailSize"><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></div>
      </section>
      <section class="panel pad stack">
        <h3>データ</h3>
        <p>グループ ${groups.length}件 / 生成画像 ${images.length}枚 / 参考画像 ${refs.length}枚</p>
        <p>概算使用量: ${sizeText(bytes)}</p>
        <p>保存画像は最大1024pxのWebPのみです。元画像はIndexedDBにもZIPにも保存しません。</p>
        <p>最終バックアップ: ${settings.lastBackupAt ? fmtDate(settings.lastBackupAt) : "未作成"}</p>
        <button class="primary" id="exportZip">ZIPエクスポート</button>
        <div class="field"><label for="importZip">ZIPインポート</label><input id="importZip" type="file" accept=".zip,application/zip"></div>
        <div class="row-actions">
          <button id="importAppend">追加インポート</button>
          <button id="importReplace" class="danger">全置換インポート</button>
        </div>
        <button id="deleteAll" class="danger">全データ削除</button>
      </section>
      <section class="panel pad stack">
        <h3>Supabase同期</h3>
        <p>ログインすると、PCとスマホでプロンプト、タグ、メモ、ステータス、1024px WebP画像を共有できます。</p>
        <p>状態: ${sessionEmail ? `ログイン中 (${escapeHtml(sessionEmail)})` : "未ログイン"}${state.syncStatus ? ` / ${escapeHtml(state.syncStatus)}` : ""}</p>
        ${state.syncDetail ? `<p class="meta">${escapeHtml(state.syncDetail)}</p>` : ""}
        ${state.syncError ? `<div class="prompt-box"><strong>同期エラー:</strong> ${escapeHtml(state.syncError)}</div>` : ""}
        ${state.syncDebug ? `<div class="prompt-box">${escapeHtml(state.syncDebug)}</div>` : ""}
        <p>最終同期: ${settings.lastSyncAt ? fmtDate(settings.lastSyncAt) : "未同期"}</p>
        <div class="field"><label for="supabaseUrl">Project URL</label><input id="supabaseUrl" value="${escapeHtml(settings.supabaseUrl || "")}"></div>
        <div class="field"><label for="supabaseKey">Publishable key</label><input id="supabaseKey" value="${escapeHtml(settings.supabaseKey || "")}"></div>
        <label><input id="autoSync" type="checkbox" ${settings.autoSync ? "checked" : ""}> ログイン中は保存後に自動同期</label>
        <div class="field"><label for="syncEmail">メールアドレス</label><input id="syncEmail" type="email" autocomplete="email"></div>
        <div class="field"><label for="syncPassword">パスワード</label><input id="syncPassword" type="password" autocomplete="current-password"></div>
        <div class="row-actions">
          <button id="syncSignUp">新規登録</button>
          <button class="primary" id="syncSignIn">ログイン</button>
          <button id="syncSignOut">ログアウト</button>
        </div>
        <div class="row-actions">
          <button id="syncPull">クラウドの内容で更新</button>
          <button id="syncPush">この端末の内容をアップロード</button>
          <button id="syncDiag">同期診断</button>
        </div>
      </section>
      <section class="panel pad stack">
        <h3>アプリ情報</h3>
        <p>Version ${APP_VERSION}</p>
        <p>画像生成APIは使用しません。Supabase同期を有効にした場合のみ、ログイン中のSupabaseプロジェクトへデータを送信します。</p>
      </section>
    </div>
  `);
  $("#theme").value = settings.theme;
  $("#thumbnailSize").value = settings.thumbnailSize;
  $("#theme").addEventListener("change", (event) => updateSettings({ theme: event.target.value }));
  $("#thumbnailSize").addEventListener("change", (event) => updateSettings({ thumbnailSize: event.target.value }));
  $("#supabaseUrl").addEventListener("change", (event) => updateSettings({ supabaseUrl: event.target.value.trim() }));
  $("#supabaseKey").addEventListener("change", (event) => updateSettings({ supabaseKey: event.target.value.trim() }));
  $("#autoSync").addEventListener("change", (event) => updateSettings({ autoSync: event.target.checked }));
  $("#syncSignUp").addEventListener("click", async () => {
    try {
      const supabaseUrl = $("#supabaseUrl").value.trim();
      const supabaseKey = $("#supabaseKey").value.trim();
      const email = $("#syncEmail").value.trim();
      const password = $("#syncPassword").value;
      await updateSettings({ supabaseUrl, supabaseKey });
      await cloudSignUp(email, password);
      toast("確認メールが届く場合があります。確認後にログインしてください。");
    } catch (error) {
      toast(error.message || "Supabase登録に失敗しました。");
    }
  });
  $("#syncSignIn").addEventListener("click", async () => {
    try {
      const supabaseUrl = $("#supabaseUrl").value.trim();
      const supabaseKey = $("#supabaseKey").value.trim();
      const email = $("#syncEmail").value.trim();
      const password = $("#syncPassword").value;
      await updateSettings({ supabaseUrl, supabaseKey });
      await cloudSignIn(email, password);
      toast("Supabaseにログインしました。");
      render();
    } catch (error) {
      toast(error.message || "Supabaseログインに失敗しました。");
    }
  });
  $("#syncSignOut").addEventListener("click", async () => {
    try {
      await cloudSignOut();
      toast("Supabaseからログアウトしました。");
    } catch (error) {
      toast(error.message || "ログアウトに失敗しました。");
    }
  });
  $("#syncPull").addEventListener("click", async () => {
    const ok = await syncFromCloud({ force: true, replace: true });
    if (ok) toast("クラウドの内容で更新しました。");
    render();
  });
  $("#syncPush").addEventListener("click", async () => {
    const ok = await syncToCloud();
    if (ok) toast("この端末の内容をアップロードしました。");
    render();
  });
  $("#syncDiag").addEventListener("click", async () => {
    await runCloudDiagnostics();
    render();
  });
  $("#exportZip").addEventListener("click", exportZip);
  $("#importAppend").addEventListener("click", () => importZip(false));
  $("#importReplace").addEventListener("click", async () => {
    if (await askConfirm("全置換インポート", "現在の全データを削除してZIPの内容に置き換えます。", "置き換え")) importZip(true);
  });
  $("#deleteAll").addEventListener("click", async () => {
    if (!await askConfirm("全データ削除", "IndexedDB内の全データを完全に削除します。バックアップ済みか確認してください。", "全削除")) return;
    const transaction = tx(["promptGroups", "generatedImages", "referenceImages", "settings"], "readwrite");
    await Promise.all(["promptGroups", "generatedImages", "referenceImages", "settings"].map((store) => clearStore(store, transaction)));
    state.settings = await defaultSettings();
    toast("全データを削除しました。");
    render();
  });
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function dosTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime();
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new ArrayBuffer(30 + nameBytes.length);
    const view = new DataView(local);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    new Uint8Array(local, 30).set(nameBytes);
    chunks.push(new Uint8Array(local), data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.byteLength + data.length;
  }
  const centralStart = offset;
  for (const item of central) {
    const head = new ArrayBuffer(46 + item.nameBytes.length);
    const view = new DataView(head);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, item.crc, true);
    view.setUint32(20, item.size, true);
    view.setUint32(24, item.size, true);
    view.setUint16(28, item.nameBytes.length, true);
    view.setUint32(42, item.offset, true);
    new Uint8Array(head, 46).set(item.nameBytes);
    chunks.push(new Uint8Array(head));
    offset += head.byteLength;
  }
  const end = new ArrayBuffer(22);
  const view = new DataView(end);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, central.length, true);
  view.setUint16(10, central.length, true);
  view.setUint32(12, offset - centralStart, true);
  view.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end));
  return new Blob(chunks, { type: "application/zip" });
}

async function parseZip(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files = new Map();
  let pos = 0;
  while (pos < buffer.byteLength - 4) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(pos + 8, true);
    if (method !== 0) throw new Error("このZIPは無圧縮形式のみ読み込めます。このアプリでエクスポートしたZIPを指定してください。");
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = decoder.decode(new Uint8Array(buffer, pos + 30, nameLen));
    const start = pos + 30 + nameLen + extraLen;
    files.set(name, new Blob([buffer.slice(start, start + size)]));
    pos = start + size;
  }
  return files;
}

async function exportZip() {
  try {
    const [promptGroups, generatedImages, referenceImages, settings] = await Promise.all([all("promptGroups"), all("generatedImages"), all("referenceImages"), defaultSettings()]);
    const cleanGenerated = generatedImages.map(({ blob, thumbnailBlob, ...meta }) => ({
      ...meta,
      filePath: `images/generated/${meta.id}.webp`,
      thumbnailPath: `images/generated/${meta.id}.webp`,
      storageMode: meta.storageMode || "webp-1024-only"
    }));
    const cleanRefs = referenceImages.map(({ blob, thumbnailBlob, ...meta }) => ({
      ...meta,
      filePath: `images/references/${meta.id}.webp`,
      thumbnailPath: `images/references/${meta.id}.webp`,
      storageMode: meta.storageMode || "webp-1024-only"
    }));
    const metadata = { version: 1, exportedAt: now(), appName: "ChatGPT Image Archive", promptGroups, generatedImages: cleanGenerated, referenceImages: cleanRefs, settings };
    const files = [{ name: "metadata.json", blob: new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }) }];
    generatedImages.forEach((image) => {
      files.push({ name: `images/generated/${image.id}.webp`, blob: image.blob });
    });
    referenceImages.forEach((image) => {
      files.push({ name: `images/references/${image.id}.webp`, blob: image.blob });
    });
    const zip = await createZip(files);
    const date = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const filename = `chatgpt-image-archive-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`;
    const link = document.createElement("a");
    link.href = blobUrl(zip);
    link.download = filename;
    link.click();
    await updateSettings({ lastBackupAt: now() });
    toast("ZIPをエクスポートしました。");
  } catch (error) {
    toast(error.message || "ZIPエクスポートに失敗しました。");
  }
}

async function importZip(replace) {
  const file = $("#importZip").files[0];
  if (!file) {
    toast("インポートするZIPファイルを選択してください。");
    return;
  }
  try {
    const files = await parseZip(file);
    if (!files.has("metadata.json")) throw new Error("metadata.json が見つかりません。");
    const metadata = JSON.parse(await files.get("metadata.json").text());
    if (metadata.version !== 1) throw new Error("未対応のバックアップバージョンです。");
    const idMap = new Map();
    const existingIds = new Set([...(await all("promptGroups")).map((x) => x.id), ...(await all("generatedImages")).map((x) => x.id), ...(await all("referenceImages")).map((x) => x.id)]);
    const mapId = (id, prefix) => {
      if (!replace && existingIds.has(id)) {
        if (!idMap.has(id)) idMap.set(id, uid(prefix));
        return idMap.get(id);
      }
      return id;
    };
    const groups = metadata.promptGroups.map((group) => ({ ...group, id: mapId(group.id, "grp"), representativeImageId: group.representativeImageId ? mapId(group.representativeImageId, "img") : undefined }));
    const generated = await Promise.all(metadata.generatedImages.map(async (image) => {
      const archivePath = image.thumbnailPath || image.filePath;
      if (!archivePath || !files.has(archivePath)) throw new Error(`ZIP内の画像ファイルが不足しています: ${image.id}`);
      const archiveBlob = files.get(archivePath);
      return {
        ...image,
        id: mapId(image.id, "img"),
        groupId: mapId(image.groupId, "grp"),
        blob: archiveBlob,
        thumbnailBlob: archiveBlob,
        fileType: archiveBlob.type || "image/webp",
        storageMode: "webp-1024-only"
      };
    }));
    const refs = await Promise.all(metadata.referenceImages.map(async (image) => {
      const archivePath = image.thumbnailPath || image.filePath;
      if (!archivePath || !files.has(archivePath)) throw new Error(`ZIP内の参考画像ファイルが不足しています: ${image.id}`);
      const archiveBlob = files.get(archivePath);
      return {
        ...image,
        id: mapId(image.id, "ref"),
        groupId: mapId(image.groupId, "grp"),
        blob: archiveBlob,
        thumbnailBlob: archiveBlob,
        fileType: archiveBlob.type || "image/webp",
        storageMode: "webp-1024-only"
      };
    }));
    const existingHashes = new Set([...(await all("generatedImages")), ...(await all("referenceImages"))].map((image) => image.hash));
    const duplicates = [...generated, ...refs].filter((image) => existingHashes.has(image.hash));
    if (!replace && duplicates.length && !await askConfirm("重複画像の確認", `${duplicates.length}枚の画像が既存データと完全一致しています。続行しますか？`, "続行")) return;
    const transaction = tx(["promptGroups", "generatedImages", "referenceImages", "settings"], "readwrite");
    if (replace) await Promise.all(["promptGroups", "generatedImages", "referenceImages"].map((store) => clearStore(store, transaction)));
    await Promise.all(groups.map((group) => put("promptGroups", group, transaction)));
    await Promise.all(generated.map((image) => put("generatedImages", image, transaction)));
    await Promise.all(refs.map((image) => put("referenceImages", image, transaction)));
    await put("settings", { ...(metadata.settings || {}), id: "settings", appVersion: APP_VERSION }, transaction);
    state.settings = await defaultSettings();
    toast("ZIPをインポートしました。");
    navigate("/groups");
  } catch (error) {
    toast(error.message || "ZIPインポートに失敗しました。");
  }
}

async function render() {
  if (!state.db) return;
  cleanupUrls();
  state.settings = state.settings || await defaultSettings();
  document.documentElement.dataset.theme = state.settings.theme;
  if (state.settings.thumbnailSize === "small") document.documentElement.style.setProperty("--card-min", "170px");
  if (state.settings.thumbnailSize === "medium") document.documentElement.style.setProperty("--card-min", "210px");
  if (state.settings.thumbnailSize === "large") document.documentElement.style.setProperty("--card-min", "270px");
  const route = state.route;
  if (route === "/" || route === "/groups") return renderGroupList();
  if (route === "/images") return renderImageList();
  if (route === "/new") return renderNewGroup();
  if (route === "/settings") return renderSettings();
  if (route.startsWith("/group/")) return renderGroupDetail(route.split("/")[2]);
  if (route.startsWith("/image/")) return renderImageDetail(route.split("/")[2]);
  return renderGroupList();
}

window.addEventListener("hashchange", () => {
  state.route = location.hash.replace(/^#/, "") || "/groups";
  render();
});

window.addEventListener("beforeunload", cleanupUrls);

async function boot() {
  state.db = await openDb();
  state.settings = await defaultSettings();
  await migrateLegacyStoredImages();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
  if (state.settings.autoSync) {
    getSupabaseClient()
      .then((supabase) => supabase.auth.getSession())
      .then(async ({ data }) => {
        if (!data.session) return;
        await syncFromCloud({ force: true, replace: true });
        render();
      })
      .catch(() => {});
  }
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="content"><div class="panel pad">起動に失敗しました: ${escapeHtml(error.message)}</div></div>`;
});
