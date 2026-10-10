// Puts the HUD into its zones (css/hud.css): moves the separate status chips into one stack, tags the heat HUD, tracks "playing" and "onboarding" on <body>,
// and measures the vehicle panel so prompts float above it instead of under it.
export function layoutHud({ isPlaying, isOnboarding }) {
  const stack = document.createElement("div"); stack.id = "hud-stack"; document.body.appendChild(stack);
  const adopt = (el, id) => { if (el && el.parentElement !== stack) { if (id) el.id = id; stack.appendChild(el); } };
  setInterval(() => {
    adopt(document.getElementById("prog"));
    for (const el of document.body.children) {                                   // the wolf chip has no id: find it by its paw
      if (el !== stack && el.tagName === "DIV" && !el.id && el.textContent?.startsWith("Wolves") && el.style.position === "fixed") adopt(el, "wolfchip");
      if (el !== stack && el.tagName === "DIV" && !el.id && /Heat \d+ %|★/.test(el.textContent || "") && el.style.position === "fixed" && el.style.pointerEvents === "none" && !el.classList.contains("heathud")) el.classList.add("heathud");
    }
    adopt(document.getElementById("mchip")); adopt(document.getElementById("wolfchip"));
    document.body.classList.toggle("playing", !!isPlaying());
    document.body.classList.toggle("onboarding", !!isOnboarding());
    const rp = document.getElementById("ridepanel");
    document.body.style.setProperty("--panel-h", (rp && rp.offsetParent !== null ? rp.offsetHeight : 64) + "px");
  }, 400);
}
