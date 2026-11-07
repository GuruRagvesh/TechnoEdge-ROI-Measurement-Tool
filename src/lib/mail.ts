import nodemailer from "nodemailer";
import { required } from "./config";
import { AppError } from "./types";
export async function sendVerificationEmail(
  email: string,
  code: string,
  id: string,
  fetcher: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
) {
  const subject = "Your TechnoEdge verification code",
    text = `Your TechnoEdge code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`;
  if ((process.env.MAIL_PROVIDER || "smtp") === "resend") {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + required("RESEND_API_KEY"),
            "Content-Type": "application/json",
            "Idempotency-Key": "te-otp-" + id,
          },
          body: JSON.stringify({
            from: required("EMAIL_FROM"),
            to: [email],
            subject,
            text,
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        if (attempt === 2)
          throw new AppError(
            503,
            "Email delivery unavailable. Retry shortly.",
            "EMAIL_UNAVAILABLE",
          );
        await sleep(300 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        const result = await response.json();
        if (typeof result.id !== "string")
          throw new AppError(
            503,
            "Email acceptance could not be confirmed",
            "EMAIL_UNAVAILABLE",
          );
        return;
      }
      if (response.status !== 429 && response.status < 500)
        throw new AppError(
          503,
          "Email provider configuration requires administrator attention",
          "EMAIL_UNAVAILABLE",
        );
      const retry = response.headers.get("retry-after"),
        delay =
          retry && /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : 300 * 2 ** attempt;
      if (attempt === 2 || delay > 20000)
        throw new AppError(
          503,
          "Email service busy. Retry shortly.",
          "EMAIL_UNAVAILABLE",
        );
      await sleep(delay);
    }
    return;
  }
  if ((process.env.MAIL_PROVIDER || "smtp") !== "smtp")
    throw new AppError(
      503,
      "Email provider is not configured",
      "EMAIL_UNAVAILABLE",
    );
  const mail = nodemailer.createTransport({
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: true,
    connectionTimeout: 15000,
    socketTimeout: 20000,
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASSWORD") },
  });
  try {
    await mail.sendMail({
      from: required("EMAIL_FROM"),
      to: email,
      subject,
      text,
    });
  } catch {
    throw new AppError(
      503,
      "Email delivery unavailable. Retry shortly.",
      "EMAIL_UNAVAILABLE",
    );
  }
}
