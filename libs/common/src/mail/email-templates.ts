export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

export type EmailCta = {
  label: string;
  url: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLayout(input: {
  preheader: string;
  title: string;
  greeting?: string;
  paragraphs: string[];
  cta?: EmailCta;
  secondaryCtas?: EmailCta[];
  footnotes?: string[];
  appUrl: string;
}): string {
  const accent = '#0f766e';
  const text = '#0f172a';
  const muted = '#64748b';
  const border = '#e2e8f0';
  const panel = '#ffffff';
  const pageBg = '#f1f5f9';

  const greeting = input.greeting
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${text};">${escapeHtml(input.greeting)}</p>`
    : '';

  const paragraphs = input.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${text};">${p}</p>`,
    )
    .join('');

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
        <tr>
          <td style="border-radius:10px;background:${accent};">
            <a href="${escapeHtml(input.cta.url)}"
               style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeHtml(input.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:${muted};word-break:break-all;">
        Or paste this link into your browser:<br/>
        <a href="${escapeHtml(input.cta.url)}" style="color:${accent};">${escapeHtml(input.cta.url)}</a>
      </p>`
    : '';

  const secondary = (input.secondaryCtas ?? [])
    .map(
      (item) =>
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${text};">
          <a href="${escapeHtml(item.url)}" style="color:${accent};font-weight:600;text-decoration:none;">
            ${escapeHtml(item.label)} →
          </a>
        </p>`,
    )
    .join('');

  const footnotes = (input.footnotes ?? [])
    .map(
      (note) =>
        `<p style="margin:0 0 8px;font-size:12px;line-height:1.55;color:${muted};">${note}</p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(input.preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pageBg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${panel};border:1px solid ${border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px;background:${accent};">
              <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:0.02em;color:#ffffff;">Relay</p>
              <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);">Private team messaging</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${text};font-weight:700;">
                ${escapeHtml(input.title)}
              </h1>
              ${greeting}
              ${paragraphs}
              ${cta}
              ${secondary}
              ${footnotes}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid ${border};background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:${muted};">
                Sent by Relay ·
                <a href="${escapeHtml(input.appUrl)}" style="color:${accent};text-decoration:none;">Open Relay</a>
              </p>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.5;color:${muted};">
                If you weren’t expecting this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function joinText(lines: string[]): string {
  return lines.filter(Boolean).join('\n\n');
}

export function verifyEmailTemplate(input: {
  appUrl: string;
  verifyUrl: string;
  expiresHours?: number;
}): EmailContent {
  const hours = input.expiresHours ?? 48;
  const subject = 'Verify your email for Relay';
  const text = joinText([
    'Welcome to Relay',
    'Please confirm your email address to finish setting up your account.',
    `Verify email: ${input.verifyUrl}`,
    `This link expires in ${hours} hours.`,
    'If you did not create a Relay account, you can ignore this email.',
  ]);
  const html = renderLayout({
    appUrl: input.appUrl,
    preheader: 'Confirm your email to activate your Relay account.',
    title: 'Confirm your email',
    greeting: 'Welcome to Relay,',
    paragraphs: [
      'Thanks for signing up. Confirm your email address to secure your account and start messaging with your team.',
      `This verification link expires in <strong>${hours} hours</strong>.`,
    ],
    cta: { label: 'Verify email address', url: input.verifyUrl },
    footnotes: [
      'If the button does not work, copy and paste the link above into your browser.',
    ],
  });
  return { subject, text, html };
}

export function resetPasswordTemplate(input: {
  appUrl: string;
  resetUrl: string;
  expiresHours?: number;
}): EmailContent {
  const hours = input.expiresHours ?? 2;
  const subject = 'Reset your Relay password';
  const text = joinText([
    'Password reset request',
    'We received a request to reset the password for your Relay account.',
    `Reset password: ${input.resetUrl}`,
    `This link expires in ${hours} hours.`,
    'If you did not request a password reset, you can safely ignore this email. Your password will stay the same.',
  ]);
  const html = renderLayout({
    appUrl: input.appUrl,
    preheader: 'Use this secure link to choose a new Relay password.',
    title: 'Reset your password',
    greeting: 'Hi there,',
    paragraphs: [
      'We received a request to reset the password for your Relay account.',
      `For your security, this link expires in <strong>${hours} hours</strong> and can only be used once.`,
    ],
    cta: { label: 'Choose a new password', url: input.resetUrl },
    footnotes: [
      'If you did not request this, no action is needed — your password will remain unchanged.',
    ],
  });
  return { subject, text, html };
}

export function workspaceInviteTemplate(input: {
  appUrl: string;
  inviteUrl: string;
  organizationName: string;
  expiresAt: string;
  role?: 'member' | 'guest';
}): EmailContent {
  const org = input.organizationName;
  const roleLabel = input.role === 'guest' ? ' as a guest' : '';
  const subject = `You’re invited to join ${org} on Relay`;
  const expiresLabel = new Date(input.expiresAt).toLocaleString();
  const text = joinText([
    `You're invited to ${org} on Relay${roleLabel}.`,
    'Relay is a private messenger for teams — channels, DMs, and presence without the noise.',
    `Accept invite: ${input.inviteUrl}`,
    `This invitation expires on ${expiresLabel}.`,
  ]);
  const html = renderLayout({
    appUrl: input.appUrl,
    preheader: `Join ${org} on Relay and start collaborating.`,
    title: `Join ${org}`,
    greeting: 'You’ve been invited,',
    paragraphs: [
      `You’re invited to join <strong>${escapeHtml(org)}</strong> on Relay${roleLabel}.`,
      'Relay is a private messenger for teams — channels, direct messages, and presence without the extra noise.',
      `This invitation expires on <strong>${escapeHtml(expiresLabel)}</strong>.`,
    ],
    cta: { label: 'Accept invitation', url: input.inviteUrl },
  });
  return { subject, text, html };
}

export function channelAddedTemplate(input: {
  appUrl: string;
  channelUrl: string;
  channelName: string;
  organizationName: string;
}): EmailContent {
  const channel = input.channelName.startsWith('#')
    ? input.channelName
    : `#${input.channelName}`;
  const subject = `You’ve been added to ${channel} on Relay`;
  const text = joinText([
    `You were added to ${channel} in ${input.organizationName} on Relay.`,
    `Open the channel: ${input.channelUrl}`,
  ]);
  const html = renderLayout({
    appUrl: input.appUrl,
    preheader: `You’re now a member of ${channel} in ${input.organizationName}.`,
    title: `Added to ${channel}`,
    greeting: 'Good news,',
    paragraphs: [
      `You’ve been added to <strong>${escapeHtml(channel)}</strong> in <strong>${escapeHtml(input.organizationName)}</strong>.`,
      'Open Relay to catch up on the conversation and say hello.',
    ],
    cta: { label: `Open ${channel}`, url: input.channelUrl },
  });
  return { subject, text, html };
}

export function channelInviteTemplate(input: {
  appUrl: string;
  channelName: string;
  organizationName: string;
  channelUrl: string;
  workspaceUrl?: string | null;
  /** When true, accepting the workspace invite also joins this channel. */
  autoJoinChannel?: boolean;
}): EmailContent {
  const channel = input.channelName.startsWith('#')
    ? input.channelName
    : `#${input.channelName}`;
  const subject = `Invite to ${channel} on Relay`;
  const autoJoin = Boolean(input.autoJoinChannel && input.workspaceUrl);

  const text = joinText([
    `You're invited to ${channel} in ${input.organizationName} on Relay.`,
    autoJoin
      ? `Accept this invite to join the workspace and ${channel}:\n${input.workspaceUrl}`
      : input.workspaceUrl
        ? `1) Join the workspace:\n${input.workspaceUrl}\n\n2) Then join the channel:\n${input.channelUrl}`
        : `Join the channel:\n${input.channelUrl}`,
  ]);

  const paragraphs = autoJoin
    ? [
        `You’re invited to <strong>${escapeHtml(channel)}</strong> in <strong>${escapeHtml(input.organizationName)}</strong>.`,
        'Accept once to join the workspace and this channel automatically — just like Slack.',
      ]
    : input.workspaceUrl
      ? [
          `You’re invited to <strong>${escapeHtml(channel)}</strong> in <strong>${escapeHtml(input.organizationName)}</strong>.`,
          'If you’re new to this workspace, accept the workspace invite first, then join the channel.',
        ]
      : [
          `You’re invited to join <strong>${escapeHtml(channel)}</strong> in <strong>${escapeHtml(input.organizationName)}</strong>.`,
          'Use the button below to open the invite and join the conversation.',
        ];

  const html = renderLayout({
    appUrl: input.appUrl,
    preheader: `Join ${channel} in ${input.organizationName} on Relay.`,
    title: `Join ${channel}`,
    greeting: 'You’re invited,',
    paragraphs,
    cta: autoJoin
      ? { label: `Join ${channel}`, url: input.workspaceUrl! }
      : input.workspaceUrl
        ? { label: 'Join workspace', url: input.workspaceUrl }
        : { label: `Join ${channel}`, url: input.channelUrl },
    secondaryCtas:
      !autoJoin && input.workspaceUrl
        ? [{ label: `Then join ${channel}`, url: input.channelUrl }]
        : undefined,
  });
  return { subject, text, html };
}
