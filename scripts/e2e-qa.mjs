/**
 * End-to-end QA script for Space Survival auth + home handoff.
 * Run: node scripts/e2e-qa.mjs
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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=390,844"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });

  page.on("pageerror", (err) => bug("JS", `pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });

  // --- Auth screen visible ---
  const authActive = await page.$eval("#screen-auth", (el) => el.classList.contains("active"));
  if (authActive) ok("A1", "Auth screen active on load");
  else bug("A1", "Auth screen not active on load");

  const loginVisible = await page.$eval("#authViewLogin", (el) => !el.hidden);
  if (loginVisible) ok("A2", "Login view visible");
  else bug("A2", "Login view hidden");

  // --- Sign up ---
  await page.click("#btnGoSignup");
  await page.waitForSelector("#authViewSignup:not([hidden])");
  const email = `qa_${Date.now()}@testmail.dev`;
  const password = "testpass123";
  await page.type("#signupEmail", email);
  await page.type("#signupPassword", password);
  await page.click("#signupForm button[type=submit]");

  // Should reach home with toast
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-home")?.classList.contains("active"),
      { timeout: 12000 },
    );
    ok("S1", "Signup reached home screen");
  } catch {
    const authStill = await page.$eval("#screen-auth", (el) => el.classList.contains("active"));
    const signupMsg = await page.$eval("#signupMsg", (el) => el.textContent);
    bug("S1", `Signup did not reach home (authStill=${authStill}, msg="${signupMsg}")`);
  }

  const toastText = await page.$eval("#appToast", (el) =>
    el.classList.contains("screen-hidden") ? "" : el.textContent,
  );
  if (toastText.toLowerCase().includes("created") || toastText.toLowerCase().includes("welcome")) {
    ok("S2", `Welcome toast shown: "${toastText}"`);
  } else {
    bug("S2", `No welcome toast after signup (got "${toastText}")`);
  }

  const profileName = await page.$eval("#profileName", (el) => el.textContent);
  if (profileName && profileName !== "Commander" && profileName !== "Pilot") {
    ok("S3", `Profile name set: ${profileName}`);
  } else {
    // might still be Commander briefly — check auth username
    const name = await page.evaluate(() => document.getElementById("profileName")?.textContent);
    if (name && name !== "Pilot") ok("S3", `Profile name: ${name}`);
    else bug("S3", `Profile name unexpected: ${name}`);
  }

  // Home buttons present
  for (const id of ["btnPlay", "btnHomeShop", "btnHomeSettings"]) {
    const exists = await page.$(`#${id}`);
    if (exists) ok("H1", `${id} present`);
    else bug("H1", `${id} missing`);
  }

  // --- Switch account / logout ---
  await page.click("#btnProfileLogout");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-auth")?.classList.contains("active"),
      { timeout: 10000 },
    );
    ok("L1", "Logout returned to auth");
  } catch {
    const home = await page.$eval("#screen-home", (el) => el.classList.contains("active"));
    const auth = await page.$eval("#screen-auth", (el) => el.classList.contains("active"));
    bug("L1", `Logout did not return to auth (home=${home} auth=${auth})`);
    // Force clear for remaining tests
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    });
    await page.waitForSelector("#screen-auth.active", { timeout: 10000 });
  }

  // --- Login ---
  await page.waitForSelector("#authViewLogin:not([hidden])");
  await page.click("#loginEmail", { clickCount: 3 });
  await page.type("#loginEmail", email);
  await page.click("#loginPassword", { clickCount: 3 });
  await page.type("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-home")?.classList.contains("active"),
      { timeout: 12000 },
    );
    ok("L2", "Login reached home");
  } catch {
    const msg = await page.$eval("#loginMsg", (el) => el.textContent);
    bug("L2", `Login failed to reach home: "${msg}"`);
  }

  // --- Wrong password ---
  await page.evaluate(() => document.getElementById("btnProfileLogout")?.click());
  await page.waitForFunction(
    () => document.getElementById("screen-auth")?.classList.contains("active"),
    { timeout: 10000 },
  );
  await page.waitForSelector("#authViewLogin:not([hidden])");
  await page.evaluate(() => {
    document.getElementById("loginEmail").value = "";
    document.getElementById("loginPassword").value = "";
  });
  await page.type("#loginEmail", email);
  await page.type("#loginPassword", "wrongpass999");
  await page.click("#loginForm button[type=submit]");
  await page.waitForFunction(() => document.getElementById("loginMsg")?.textContent?.length > 0, {
    timeout: 8000,
  });
  const wrongMsg = await page.$eval("#loginMsg", (el) => el.textContent);
  if (/wrong|credential|password|could not/i.test(wrongMsg)) ok("L3", `Wrong password message: ${wrongMsg}`);
  else bug("L3", `Unexpected wrong-password message: ${wrongMsg}`);

  // --- Forgot password OTP ---
  await page.evaluate(() => document.getElementById("btnForgotOpen")?.click());
  await page.waitForSelector("#authViewForgot:not([hidden])");
  await page.evaluate((em) => {
    document.getElementById("forgotEmail").value = em;
  }, email);
  await page.click("#btnForgotSend");
  try {
    await page.waitForSelector("#forgotStepOtp:not([hidden])", { timeout: 10000 });
    ok("F1", "Forgot OTP step shown");
  } catch {
    const fm = await page.$eval("#forgotMsg", (el) => el.textContent);
    bug("F1", `OTP step not shown: "${fm}"`);
  }

  const banner = await page.$eval("#otpBanner", (el) => ({
    hidden: el.classList.contains("screen-hidden"),
    text: el.textContent,
  }));
  const otpMatch = banner.text.match(/(\d{6})/);
  if (!banner.hidden && otpMatch) ok("F2", `OTP banner shows code ${otpMatch[1]}`);
  else bug("F2", `OTP not visible in banner: hidden=${banner.hidden} text="${banner.text}"`);

  if (otpMatch) {
    const newPass = "newpass456";
    await page.evaluate(
      (code, pass) => {
        document.getElementById("forgotOtp").value = code;
        document.getElementById("forgotPassword").value = pass;
        document.getElementById("forgotResetForm").requestSubmit();
      },
      otpMatch[1],
      newPass,
    );
    await page.waitForFunction(
      () => {
        const login = !document.getElementById("authViewLogin")?.hidden;
        const otpMsg = document.getElementById("forgotOtpMsg")?.textContent || "";
        const loginMsg = document.getElementById("loginMsg")?.textContent || "";
        return (
          (login && /updated|email link|log in with/i.test(loginMsg)) ||
          document.getElementById("screen-home")?.classList.contains("active") ||
          (/could not|invalid|expired|otp ok/i.test(otpMsg) &&
            otpMsg !== "Code ready — enter a new password below.")
        );
      },
      { timeout: 20000 },
    );
    const state = await page.evaluate(() => ({
      login: !document.getElementById("authViewLogin")?.hidden,
      forgot: !document.getElementById("authViewForgot")?.hidden,
      home: document.getElementById("screen-home")?.classList.contains("active"),
      auth: document.getElementById("screen-auth")?.classList.contains("active"),
      loginMsg: document.getElementById("loginMsg")?.textContent || "",
      otpMsg: document.getElementById("forgotOtpMsg")?.textContent || "",
    }));
    if (
      (state.login && /updated|email link|log in with/i.test(state.loginMsg)) ||
      state.home
    ) {
      ok("F3", `Reset completed UI: ${JSON.stringify(state)}`);
    } else {
      bug("F3", `Reset unclear: ${JSON.stringify(state)}`);
    }

    // Try login with new password if we're on login with success
    if (state.login && /updated/i.test(state.loginMsg)) {
      await page.evaluate(
        (em, pass) => {
          document.getElementById("loginEmail").value = em;
          document.getElementById("loginPassword").value = pass;
        },
        email,
        newPass,
      );
      await page.click("#loginForm button[type=submit]");
      try {
        await page.waitForFunction(
          () => document.getElementById("screen-home")?.classList.contains("active"),
          { timeout: 12000 },
        );
        ok("F4", "Login with new password works");
      } catch {
        const m = await page.$eval("#loginMsg", (el) => el.textContent);
        bug("F4", `Login with new password failed: "${m}"`);
      }
    } else if (state.home) {
      ok("F4", "Reset logged user in directly");
    } else if (state.login && /email link/i.test(state.loginMsg)) {
      ok("F4", "Reset requires email link (no refresh token path) — expected on some flows");
    } else {
      bug("F4", `Could not verify new password login: ${JSON.stringify(state)}`);
    }
  }

  // --- Guest ---
  await page.goto(BASE, { waitUntil: "networkidle0" });
  // clear session
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.click("#btnAuthGuest");
  try {
    await page.waitForFunction(
      () => document.getElementById("screen-home")?.classList.contains("active"),
      { timeout: 12000 },
    );
    const role = await page.$eval("#profileRole", (el) => el.textContent);
    if (role === "GUEST") ok("G1", "Guest reaches home as GUEST");
    else ok("G1", `Guest home role=${role}`);
  } catch {
    bug("G1", "Guest did not reach home");
  }

  // --- Desktop viewport ---
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  const overflow = await page.$eval("#screen-auth", (el) => {
    const card = el.querySelector(".app-shell");
    return {
      scrollWidth: card?.scrollWidth,
      clientWidth: card?.clientWidth,
      scrollHeight: card?.scrollHeight,
      clientHeight: card?.clientHeight,
    };
  });
  if (overflow.scrollWidth <= overflow.clientWidth + 2) ok("R1", "Auth no horizontal overflow on desktop");
  else bug("R1", `Horizontal overflow ${overflow.scrollWidth}>${overflow.clientWidth}`);

  // Title fully visible
  const title = await page.$eval(".app-brand-title", (el) => el.textContent.replace(/\s+/g, " ").trim());
  if (/SPACE\s*SURVIVAL/i.test(title)) ok("R2", `Title complete: ${title}`);
  else bug("R2", `Title clipped/wrong: ${title}`);

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
