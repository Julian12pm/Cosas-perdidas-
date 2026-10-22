/** The message the API hands over to the transport. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** The transport the application talks to. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** The address the institute sends from when nothing else is configured. */
const DEFAULT_FROM = 'objetos-perdidos@itmorelia.edu.mx';

async function createSmtpTransport(url: string) {
  // The SMTP client is loaded on demand so the console transport never pays
  // for the dependency.
  const { createTransport } = await import('nodemailer');
  return createTransport(url);
}

type SmtpTransport = Awaited<ReturnType<typeof createSmtpTransport>>;

/** Prints the message to the server log, the default while the institute has no domain. */
function consoleMailer(): Mailer {
  return {
    async send(message) {
      console.log(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
    },
  };
}

/** Sends the message through the SMTP server of the institute. */
function smtpMailer(url: string): Mailer {
  let transport: Promise<SmtpTransport> | undefined;
  const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
  return {
    async send(message) {
      transport ??= createSmtpTransport(url);
      const client = await transport;
      await client.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/**
 * Builds the mailer of the process.
 *
 * The transport is SMTP only when both `MAIL_TRANSPORT=smtp` and `SMTP_URL`
 * are set; everything else falls back to the console.
 */
export function createMailer(): Mailer {
  const wanted = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase();
  const url = process.env.SMTP_URL;
  if (wanted === 'smtp' && url) return smtpMailer(url);
  if (wanted === 'smtp') {
    console.warn('[mail] MAIL_TRANSPORT=smtp without SMTP_URL, falling back to the console');
  }
  return consoleMailer();
}
