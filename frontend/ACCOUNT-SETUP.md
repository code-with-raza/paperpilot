# Verified account registration

Backend code is unchanged. New users register, receive a Supabase confirmation
email, confirm their address, then log in with the password they chose.
The frontend does not treat a backend failure as a successful registration.

## Supabase dashboard prerequisites

- Authentication / email provider: keep email signups and Confirm email enabled.
- Authentication / URL Configuration: set Site URL to
  `https://paperpilot-45m.pages.dev/`. Add that exact address to the allowed
  redirect URLs if needed. The existing backend does not specify a redirect
  override, so Supabase uses Site URL.
- Authentication / SMTP settings: configure a verified sender and custom SMTP
  before allowing arbitrary new users. Supabase's default sender restricts
  delivery to project-team email addresses. Never place SMTP credentials in
  frontend variables or repository files.
- Keep the confirmation email template's working Supabase confirmation link.

References:
https://supabase.com/docs/guides/auth/auth-smtp
https://supabase.com/docs/guides/auth/redirect-urls

## Behavior

- A registration 403 with the backend's exact verification-required message
  opens the check-email screen and clears password fields.
- That screen identifies the submitted email and explains confirmation/login.
- A confirmed duplicate-account 409 offers a login link. Moving to login
  retains only the email in React memory and clears passwords.
- No automatic login is attempted for a duplicate or a backend failure.
- The workspace is opened only after the backend's session check succeeds.
- Supabase can obscure duplicate-account responses depending on Auth settings;
  the frontend cannot infer that an account exists from a generic 403 or 500.

## Live acceptance check

Keep the Codespaces backend running. Register an email outside the Supabase
project team, confirm the received message, and log in using the same address
and password. Verify the workspace opens and the new user cannot see another
user's papers. This real email-delivery test remains required after SMTP setup;
mocked frontend tests do not verify SMTP or dashboard configuration.
