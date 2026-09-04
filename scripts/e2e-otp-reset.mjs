/**
 * E2E: register → logout → OTP reset (stored-secret path) → login with new password.
 * Does not need FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.QA_BASE || "http://localhost:43127";
const chrome = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const stamp = Date.now();
const email = `pilot.reset.${stamp}@gmail.com`;
const oldPassword = `OldPass${stamp}x`;
const newPassword = `NewPass${stamp}x`;

async function main() {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 390, height: 844, isMobile: true });

  let capturedOtp = "";
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().includes("api.emailjs.com") && req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        const p = body.template_params || {};
        capturedOtp = String(p.passcode || p.otp || "");
      } catch {
        /* ignore */
      }
    }
    req.continue();
  });

  const log = (m) => console.log(`[qa-reset] ${m}`);

  await page.goto(BASE, { waitUntil: "networkidle0" });

  await page.click("#btnGoSignup");
  await page.waitForSelector("#signupForm", { visible: true });
  await page.evaluate(
    (mail, pw) => {
      document.getElementById("signupEmail").value = mail;
      document.getElementById("signupPassword").value = pw;
      document.getElementById("signupForm").requestSubmit();
    },
    email,
    oldPassword,
  );

  await page.waitForFunction(
    () => document.getElementById("screen-home")?.classList.contains("active"),
    { timeout: 25000 },
  );
  log("registered + home");

  const stored = await page.evaluate(
    (mail) => localStorage.getItem("space-survival-pw:" + mail),
    email.toLowerCase(),
  );
  if (!stored) throw new Error("local auth password was not saved after register");
  log("local recovery password saved");

  await page.click("#btnProfileLogout");
  await page.waitForSelector("#authViewLogin", { visible: true });
  log("logged out");

  await page.click("#btnForgotOpen");
  await page.waitForSelector("#forgotStepEmail", { visible: true });
  await page.evaluate((mail) => {
    document.getElementById("forgotEmail").value = mail;
  }, email);
  await page.click("#btnForgotSend");
  await page.waitForSelector("#forgotStepOtp", { visible: true });
  await page.waitForFunction(
    () => {
      const otp = document.getElementById("forgotOtp")?.value;
      const banner = document.getElementById("otpBanner")?.textContent || "";
      return (otp && /^\d{6}$/.test(otp)) || /\d{6}/.test(banner);
    },
    { timeout: 20000 },
  ).catch(() => null);

  let otp = "";
  try {
    otp = await page.$eval("#forgotOtp", (el) => el.value.trim());
  } catch {
    otp = "";
  }
  if (!/^\d{6}$/.test(otp)) {
    try {
      const banner = await page.$eval("#otpBanner", (el) => el.textContent || "");
      otp = (banner.match(/\d{6}/) || [])[0] || "";
    } catch {
      otp = "";
    }
  }
  if (!/^\d{6}$/.test(otp)) otp = capturedOtp;
  if (!/^\d{6}$/.test(otp)) throw new Error(`no OTP available (captured=${capturedOtp})`);
  log(`otp ${otp}`);

  await page.evaluate(
    (code, pw) => {
      document.getElementById("forgotOtp").value = code;
      document.getElementById("forgotPassword").value = pw;
      document.getElementById("forgotResetForm").requestSubmit();
    },
    otp,
    newPassword,
  );

  await page.waitForFunction(
    () => {
      const loginMsg = document.getElementById("loginMsg")?.textContent || "";
      const forgotMsg = document.getElementById("forgotOtpMsg")?.textContent || "";
      return /Password updated/i.test(loginMsg) || forgotMsg.length > 3;
    },
    { timeout: 30000 },
  );

  const forgotMsg = await page.$eval("#forgotOtpMsg", (el) => el.textContent || "");
  const loginMsg = await page.$eval("#loginMsg", (el) => el.textContent || "");
  if (!/Password updated/i.test(loginMsg)) {
    throw new Error(`reset failed: ${forgotMsg || loginMsg || "unknown"}`);
  }
  log(`reset ok — ${loginMsg}`);

  await page.evaluate(
    (mail, pw) => {
      document.getElementById("loginEmail").value = mail;
      document.getElementById("loginPassword").value = pw;
      document.getElementById("loginForm").requestSubmit();
    },
    email,
    newPassword,
  );
  await page.waitForFunction(
    () => document.getElementById("screen-home")?.classList.contains("active"),
    { timeout: 25000 },
  );
  log("login with NEW password ok");

  await browser.close();
  console.log("PASS otp-password-reset");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exitCode = 1;
});
