/**
 * Full second-pass E2E QA: shop, settings, play, persistence, collisions, cloud merge.
 * Run: node scripts/e2e-qa-full.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.APP_URL || "http://localhost:43127/";
const bugs = [];
const pass = [];

function ok(id, msg) {
  pass.push(`${id}: ${msg}`);
  console.log(`PASS  ${id} — ${msg}`);
}
function bug(id, msg) {
  bugs.push(`${id}: ${msg}`);
  console.log(`BUG   ${id} — ${msg}`);
}

async function clearAndReload(page) {
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
}

async function waitHome(page, timeout = 12000) {
  await page.waitForFunction(
    () => document.getElementById("screen-home")?.classList.contains("active"),
    { timeout },
  );
}

async function waitAuth(page, timeout = 12000) {
  await page.waitForFunction(
    () => document.getElementById("screen-auth")?.classList.contains("active"),
    { timeout },
  );
}

async function signup(page, email, password) {
  await page.click("#btnGoSignup");
  await page.waitForSelector("#authViewSignup:not([hidden])");
  await page.evaluate(() => {
    document.getElementById("signupEmail").value = "";
    document.getElementById("signupPassword").value = "";
  });
  await page.type("#signupEmail", email);
  await page.type("#signupPassword", password);
  await page.click("#signupForm button[type=submit]");
  await waitHome(page, 20000);
}

async function logout(page) {
  await page.click("#btnProfileLogout");
  await waitAuth(page);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=390,844"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  page.on("pageerror", (err) => bug("JS", `pageerror: ${err.message}`));

  await clearAndReload(page);

  // --- Cloud merge logic (pure) ---
  const merge = await page.evaluate(async () => {
    const { mergeShopData, mergeProgressData, mergeSettingsData } = await import(
      "/src/cloud.js"
    );
    const shop = mergeShopData(
      { coins: 100, owned: ["ship_default", "ship_crimson"], equipped: { ship: "ship_crimson", enemy: "enemy_default", prop: "prop_none" } },
      { coins: 40, owned: ["ship_default", "ship_gold"], equipped: { ship: "ship_default", enemy: "enemy_default", prop: "prop_none" } },
    );
    const progress = mergeProgressData(
      { classic: { unlocked: 3, stars: { "1": 3 }, bestScore: 500 }, boss: { unlocked: 1, stars: {}, bestScore: 0 }, endless: { bestScore: 10, bestWave: 2 } },
      { classic: { unlocked: 2, stars: { "1": 1, "2": 2 }, bestScore: 800 }, boss: { unlocked: 2, stars: { "1": 1 }, bestScore: 50 }, endless: { bestScore: 5, bestWave: 9 } },
    );
    const settings = mergeSettingsData(
      { music: false, vibration: true, selectedMode: "endless" },
      { music: true, vibration: false, selectedMode: "classic" },
    );
    return { shop, progress, settings };
  });
  if (
    merge.shop.coins === 100 &&
    merge.shop.owned.includes("ship_crimson") &&
    merge.shop.owned.includes("ship_gold") &&
    merge.shop.equipped.ship === "ship_crimson"
  ) {
    ok("M1", "Shop merge keeps max coins + union owned + local equip");
  } else {
    bug("M1", `Shop merge wrong: ${JSON.stringify(merge.shop)}`);
  }
  if (
    merge.progress.classic.unlocked === 3 &&
    merge.progress.classic.stars["1"] === 3 &&
    merge.progress.classic.stars["2"] === 2 &&
    merge.progress.classic.bestScore === 800 &&
    merge.progress.endless.bestWave === 9
  ) {
    ok("M2", "Progress merge takes max unlocks/stars/scores");
  } else {
    bug("M2", `Progress merge wrong: ${JSON.stringify(merge.progress)}`);
  }
  if (merge.settings.music === false && merge.settings.selectedMode === "endless") {
    ok("M3", "Settings merge prefers local device prefs");
  } else {
    bug("M3", `Settings merge wrong: ${JSON.stringify(merge.settings)}`);
  }

  // --- Guest → Shop ---
  await page.click("#btnAuthGuest");
  await waitHome(page);
  ok("N1", "Guest home");

  await page.click("#btnHomeShop");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-shop")?.classList.contains("active"),
      { timeout: 5000 },
    );
    const items = await page.$$("#shopGrid .shop-item");
    if (items.length >= 3) ok("SH1", `Shop shows ${items.length} ship items`);
    else bug("SH1", `Shop empty/few items: ${items.length}`);
  } catch {
    bug("SH1", "Shop screen did not open");
  }

  const buyBtn = await page.$("#shopGrid [data-buy]");
  if (buyBtn) {
    await buyBtn.click();
    const msg = await page.$eval("#shopMsg", (el) => el.textContent);
    if (/not enough|cannot/i.test(msg)) ok("SH2", `Funds gate: ${msg}`);
    else bug("SH2", `Expected funds message, got "${msg}"`);
  } else {
    bug("SH2", "No BUY button found");
  }

  // Grant coins via localStorage for THIS user, reload so main.js shop.load() picks it up
  await page.click("#btnShopBack");
  await waitHome(page);
  const granted = await page.evaluate(() => {
    const uidKeys = Object.keys(localStorage).filter((k) => k.includes(":shop"));
    // Prefer non-legacy scoped shop key for active session
    const key =
      uidKeys.find((k) => k.startsWith("space-survival:") && k.endsWith(":shop")) ||
      uidKeys[0];
    if (!key) return { ok: false, keys: Object.keys(localStorage) };
    const data = JSON.parse(localStorage.getItem(key) || "{}");
    data.coins = 500;
    data.owned = data.owned || ["ship_default", "enemy_default", "prop_none"];
    localStorage.setItem(key, JSON.stringify(data));
    return { ok: true, key, coins: data.coins };
  });
  if (granted.ok) ok("SH3", `Granted coins in ${granted.key}`);
  else bug("SH3", `No shop key to grant coins: ${JSON.stringify(granted)}`);

  await page.reload({ waitUntil: "networkidle0" });
  try {
    await waitHome(page, 15000);
  } catch {
    const auth = await page.$eval("#screen-auth", (el) => el.classList.contains("active"));
    if (auth) {
      await page.click("#btnAuthGuest");
      await waitHome(page);
    }
  }

  await page.click("#btnHomeShop");
  await page.waitForSelector("#screen-shop.active");
  const coinsUi = await page.$eval("#shopCoins", (el) => el.textContent);
  if (Number(coinsUi) >= 100) ok("SH4", `Shop UI coins after reload: ${coinsUi}`);
  else bug("SH4", `Shop UI coins still low after grant: ${coinsUi}`);

  // Buy Crimson via UI
  const bought = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".shop-item")].find((c) =>
      c.textContent.includes("Crimson Blade"),
    );
    const btn = card?.querySelector("[data-buy]");
    if (!btn) return { ok: false, reason: "no-buy-btn", text: card?.textContent };
    btn.click();
    return {
      ok: true,
      msg: document.getElementById("shopMsg")?.textContent,
      coins: document.getElementById("shopCoins")?.textContent,
      equipped: card?.classList.contains("equipped") ||
        [...document.querySelectorAll(".shop-item")].find((c) =>
          c.textContent.includes("Crimson Blade"),
        )?.classList.contains("equipped"),
    };
  });
  // renderShop re-creates DOM — re-query
  await page.waitForFunction(
    () => document.getElementById("shopMsg")?.textContent?.includes("Purchased"),
    { timeout: 5000 },
  ).catch(() => {});
  const afterBuy = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".shop-item")].find((c) =>
      c.textContent.includes("Crimson Blade"),
    );
    return {
      msg: document.getElementById("shopMsg")?.textContent,
      coins: document.getElementById("shopCoins")?.textContent,
      equipped: card?.classList.contains("equipped"),
      text: card?.textContent?.replace(/\s+/g, " ").slice(0, 100),
    };
  });
  if (afterBuy.equipped && /purchased/i.test(afterBuy.msg || "")) {
    ok("SH5", `UI buy+equip works (coins=${afterBuy.coins})`);
  } else if (bought.ok && afterBuy.equipped) {
    ok("SH5", `UI equip works after buy (coins=${afterBuy.coins})`);
  } else {
    bug("SH5", `UI buy failed: ${JSON.stringify({ bought, afterBuy })}`);
  }

  await page.click('.shop-tab[data-tab="prop"]');
  const propCount = await page.$$eval("#shopGrid .shop-item", (els) => els.length);
  if (propCount >= 3) ok("SH6", `Themes tab has ${propCount} items`);
  else bug("SH6", `Themes tab sparse: ${propCount}`);

  await page.click("#btnShopBack");
  await waitHome(page);

  // --- Settings ---
  await page.click("#btnHomeSettings");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-settings")?.classList.contains("active"),
      { timeout: 5000 },
    );
    ok("ST1", "Settings opened");
  } catch {
    bug("ST1", "Settings did not open");
  }

  await page.evaluate(() => {
    const music = document.getElementById("toggleMusic");
    const vib = document.getElementById("toggleVibration");
    music.checked = false;
    music.dispatchEvent(new Event("change", { bubbles: true }));
    vib.checked = false;
    vib.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.evaluate(() => document.getElementById("btnSettingsBack")?.click());
  await waitHome(page);
  await page.click("#btnHomeSettings");
  await page.waitForSelector("#screen-settings.active");
  const toggles = await page.evaluate(() => ({
    music: document.getElementById("toggleMusic")?.checked,
    vib: document.getElementById("toggleVibration")?.checked,
  }));
  if (toggles.music === false && toggles.vib === false) ok("ST2", "Settings persist off");
  else bug("ST2", `Settings not persisted: ${JSON.stringify(toggles)}`);
  await page.evaluate(() => document.getElementById("btnSettingsBack")?.click());
  await waitHome(page);

  // --- Play → modes → map → game → pause → menu ---
  await page.click("#btnPlay");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-modes")?.classList.contains("active"),
      { timeout: 5000 },
    );
    const modeCount = await page.$$eval("#modeGrid > *", (els) => els.length);
    if (modeCount >= 2) ok("P1", `Mode select shows ${modeCount} modes`);
    else bug("P1", `Mode grid sparse: ${modeCount}`);
  } catch {
    bug("P1", "Mode select did not open");
  }

  await page.click("#btnStartMode");
  try {
    await page.waitForFunction(
      () =>
        document.getElementById("screen-map")?.classList.contains("active") ||
        (document.getElementById("hud") &&
          !document.getElementById("hud").classList.contains("screen-hidden")),
      { timeout: 8000 },
    );
    const map = await page.$eval("#screen-map", (el) => el.classList.contains("active"));
    if (map) {
      ok("P2", "Sector map opened for classic");
      await page.click("#btnMapStart");
    } else {
      ok("P2", "Game HUD started without map");
    }
  } catch {
    bug("P2", "Neither map nor game started after LAUNCH");
  }

  try {
    await page.waitForFunction(
      () =>
        document.getElementById("hud") &&
        !document.getElementById("hud").classList.contains("screen-hidden"),
      { timeout: 8000 },
    );
    ok("P3", "In-game HUD visible");
  } catch {
    bug("P3", "HUD never appeared");
  }

  const pauseBtn = await page.$("#pauseBtn");
  if (pauseBtn) {
    await pauseBtn.click();
    try {
      await page.waitForFunction(
        () => document.getElementById("screen-pause")?.classList.contains("active"),
        { timeout: 5000 },
      );
      ok("P4", "Pause screen works");
      await page.click("#btnMenu");
      await waitHome(page);
      ok("P5", "Pause → main menu returns home");
    } catch {
      bug("P4", "Pause screen failed");
    }
  } else {
    bug("P4", "pauseBtn missing");
  }

  // Equipped ship still owned after game session
  await page.click("#btnHomeShop");
  await page.waitForSelector("#screen-shop.active");
  await page.click('.shop-tab[data-tab="ship"]');
  const stillEquipped = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".shop-item")].find((c) =>
      c.textContent.includes("Crimson Blade"),
    );
    return card?.classList.contains("equipped");
  });
  if (stillEquipped) ok("SH7", "Purchase persisted across play session");
  else bug("SH7", "Crimson Blade no longer equipped after play");
  await page.click("#btnShopBack");
  await waitHome(page);

  // --- Unique local user ids for different emails ---
  await logout(page);
  await clearAndReload(page);
  const e1 = `qa_a_${Date.now()}@alpha.dev`;
  const e2 = `qa_a_${Date.now()}@beta.dev`;
  const passw = "testpass123";
  await signup(page, e1, passw);
  const id1 = await page.evaluate(() => {
    // Read from profile / storage key side-effect
    const keys = Object.keys(localStorage).filter((k) => /space-survival:[^:]+:shop/.test(k));
    return keys.map((k) => k.split(":")[1]);
  });
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /space-survival:[^:]+:shop/.test(k));
    if (!key) return;
    const data = JSON.parse(localStorage.getItem(key) || "{}");
    data.coins = 777;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await logout(page);
  await signup(page, e2, passw);
  await page.waitForFunction(
    () => document.getElementById("profileCoins")?.textContent != null,
    { timeout: 5000 },
  );
  const activeCoins = await page.$eval("#profileCoins", (el) => Number(el.textContent || 0));
  const namespaces = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => /space-survival:[^:]+:shop/.test(k))
      .map((k) => ({ id: k.split(":")[1], coins: JSON.parse(localStorage.getItem(k) || "{}").coins || 0 })),
  );
  const uniqueIds = new Set(namespaces.map((n) => n.id));
  if (uniqueIds.size >= 2) ok("U1", `Multiple user shop namespaces: ${[...uniqueIds].join(", ")}`);
  else bug("U1", `Expected distinct user ids, got ${JSON.stringify(namespaces)}`);
  if (activeCoins !== 777) {
    ok("U2", `Active wallet isolated (profileCoins=${activeCoins}; stores=${JSON.stringify(namespaces)})`);
  } else {
    bug("U2", `Active user inherited other wallet coins: ${JSON.stringify(namespaces)}`);
  }

  // --- Duplicate signup ---
  await logout(page);
  await page.waitForSelector("#authViewLogin:not([hidden])", { timeout: 10000 });
  await page.click("#btnGoSignup");
  await page.waitForSelector("#authViewSignup:not([hidden])");
  await page.evaluate(() => {
    document.getElementById("signupEmail").value = "";
    document.getElementById("signupPassword").value = "";
    document.getElementById("signupMsg").textContent = "";
  });
  await page.type("#signupEmail", e1);
  await page.type("#signupPassword", passw);
  await page.click("#signupForm button[type=submit]");
  try {
    await page.waitForFunction(
      () => {
        const msg = document.getElementById("signupMsg")?.textContent || "";
        const home = document.getElementById("screen-home")?.classList.contains("active");
        return msg.length > 0 || home;
      },
      { timeout: 20000 },
    );
    const dup = await page.evaluate(() => ({
      home: document.getElementById("screen-home")?.classList.contains("active"),
      msg: document.getElementById("signupMsg")?.textContent || "",
    }));
    if (!dup.home && /exist|already|in use/i.test(dup.msg)) {
      ok("U3", `Duplicate signup blocked: ${dup.msg}`);
    } else if (dup.home) {
      bug("U3", "Duplicate signup incorrectly reached home");
    } else {
      bug("U3", `Unexpected duplicate signup: ${JSON.stringify(dup)}`);
    }
  } catch {
    const dup = await page.evaluate(() => ({
      home: document.getElementById("screen-home")?.classList.contains("active"),
      msg: document.getElementById("signupMsg")?.textContent || "",
      busy: document.querySelector("#signupForm button[type=submit]")?.disabled,
    }));
    bug("U3", `Duplicate signup timed out: ${JSON.stringify(dup)}`);
  }

  // --- Responsive phone home ---
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  const authActive = await page.$eval("#screen-auth", (el) => el.classList.contains("active"));
  if (authActive) {
    // Stay on auth or use guest
    await page.click("#btnGoLogin").catch(() => {});
    await page.click("#btnAuthGuest");
    await waitHome(page);
  }
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector("#screen-home .app-shell");
    return {
      sw: shell?.scrollWidth,
      cw: shell?.clientWidth,
    };
  });
  if (overflow.sw <= overflow.cw + 2) ok("R3", "Home no horizontal overflow on phone");
  else bug("R3", `Home overflow ${overflow.sw}>${overflow.cw}`);

  const ids = [
    "btnPlay",
    "btnHomeShop",
    "btnHomeSettings",
    "btnProfileLogout",
    "shopGrid",
    "modeGrid",
    "levelMap",
    "toggleMusic",
    "pauseBtn",
    "btnResume",
    "btnPlayAgain",
  ];
  const missing = await page.evaluate(
    (list) => list.filter((id) => !document.getElementById(id)),
    ids,
  );
  if (!missing.length) ok("D1", "All critical DOM ids present");
  else bug("D1", `Missing DOM ids: ${missing.join(", ")}`);

  await browser.close();

  console.log("\n==== SUMMARY ====");
  console.log(`PASS: ${pass.length}`);
  console.log(`BUGS: ${bugs.length}`);
  if (bugs.length) {
    console.log(bugs.join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
