import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMailer } from '#mail/mailer';

const originalTransport = process.env.MAIL_TRANSPORT;
const originalUrl = process.env.SMTP_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalTransport === undefined) delete process.env.MAIL_TRANSPORT;
  else process.env.MAIL_TRANSPORT = originalTransport;
  if (originalUrl === undefined) delete process.env.SMTP_URL;
  else process.env.SMTP_URL = originalUrl;
});

describe('createMailer', () => {
  it('prints the message to the log when there is no sending domain', async () => {
    delete process.env.MAIL_TRANSPORT;
    delete process.env.SMTP_URL;
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await createMailer().send({
      to: 'l123456@morelia.tecnm.mx',
      subject: 'Acceso a Objetos Perdidos ITM',
      text: 'https://localhost:5173/auth/magic-link/abc',
    });

    const printed = lines.join('\n');
    expect(printed).toContain('l123456@morelia.tecnm.mx');
    expect(printed).toContain('Acceso a Objetos Perdidos ITM');
    expect(printed).toContain('/auth/magic-link/abc');
  });

  it('falls back to the console when the SMTP server is missing', async () => {
    process.env.MAIL_TRANSPORT = 'smtp';
    delete process.env.SMTP_URL;
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await createMailer().send({ to: 'a@morelia.tecnm.mx', subject: 'Hola', text: 'Hola' });

    expect(lines.join('\n')).toContain('Hola');
  });
});
