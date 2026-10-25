import nodemailer from 'nodemailer';

/**
 * Giriş kodu e-postası. SMTP ayarları ortam değişkenlerinden gelir; Brevo için:
 *   SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... MAIL_FROM="HERMAP <kod@alanadiniz.com>"
 * SMTP ayarlı değilse (yerel geliştirme) e-posta gönderilmez, kod sunucu konsoluna yazılır.
 */
export function createMailer(env = process.env, log = console) {
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async sendLoginCode(to, code) {
        log.warn(`[e-posta ayarlı değil] ${to} için giriş kodu: ${code}`);
      },
    };
  }
  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    configured: true,
    async sendLoginCode(to, code) {
      await transport.sendMail({
        from,
        to,
        subject: `HERMAP giriş kodunuz: ${code}`,
        text: `HERMAP giriş kodunuz: ${code}\n\nKod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın.`,
        html: `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:420px;margin:auto;padding:24px">
  <div style="font-size:22px;font-weight:900;letter-spacing:1px">HERMAP</div>
  <p style="color:#3a3a3c">Giriş kodunuz:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f2f2f7;border-radius:12px;padding:14px;text-align:center">${code}</div>
  <p style="color:#6e6e73;font-size:13px">Kod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın.</p>
</div>`,
      });
    },
  };
}
