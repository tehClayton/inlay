/* Interaction shared between pages. Data will live in store.js; this is the
   other half — behaviour more than one page needs, kept in one place so it
   cannot fork into two subtly different copies. Adapted from millitap's ui.js. */

export const $ = id => document.getElementById(id);

/* aria-label and title carry the same sentence to two audiences, and a control
   with one but not the other is either unreadable to a screen reader or
   unexplained on hover. Setting both in one call keeps them in step. */
export function label(el, text){
  el.setAttribute("aria-label", text);
  el.title = text;
  return el;
}

/* A short confirmation, gone on its own. Its own element rather than a use of
   #toast: that one is the update prompt and reloads the page when tapped. */
let sayTimer = 0;
export function say(text, ms = 2200){
  const m = $("msg");
  m.textContent = text;
  m.classList.add("on");
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => m.classList.remove("on"), ms);
}

/* Cache names are prefixed "inlay-" because millitap shares this origin and
   its caches are "millitap-". The prefix is how each app finds only its own. */
export const CACHE_PREFIX = "inlay-";

/* Asked of the cache the running page was served from, not of a constant
   compiled into the page: a stale page reporting the version it wished it were
   would be worse than no figure at all. */
export function showVersion(el){
  if (!(window.caches && caches.keys)){ el.textContent = "no cache"; return; }
  caches.keys().then(ks => {
    const mine = ks.filter(k => k.startsWith(CACHE_PREFIX))
                   .map(k => k.slice(CACHE_PREFIX.length));
    el.textContent = mine.length ? mine.join(", ") : "not cached";
  }).catch(() => { el.textContent = "unavailable"; });
}

/* Service worker registration and the update prompt. The reasoning is
   millitap's, which learned it the hard way:

   - controllerchange also fires on a FIRST install, because clients.claim()
     claims a page that had no controller. Whether there was a controller when
     the page loaded is what tells an update from a first visit.
   - An installed PWA resumed from the app switcher never navigates, so nothing
     would ever ask for an update. Coming back to the foreground is when to ask.
   - The listener goes on before register(), so a fast update can't land first.

   The prompt stays a prompt: reloading by itself would throw away a session in
   progress. */
export function watchForUpdates(){
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  const offerReload = () => {
    if (reloading) return;
    const t = $("toast");
    t.hidden = false;
    t.onclick = () => { reloading = true; location.reload(); };
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;   // the first claim is not an update
    offerReload();
  });

  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      if (!reg) return;
      // Already waiting: an update arrived while the page was closed.
      if (reg.waiting && hadController) offerReload();

      let asked = 0;
      addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now - asked < 60000) return;    // not on every glance at the screen
        asked = now;
        reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
