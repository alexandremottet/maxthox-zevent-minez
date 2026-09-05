import "@south-paw/typeface-minecraft";
import { authClient } from "../lib/auth-client.ts";

const form = document.getElementById("login-form") as HTMLFormElement;
const errorEl = document.getElementById("login-error") as HTMLElement;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const formData = new FormData(form);
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const { error } = await authClient.signIn.email({ email, password });
  if (error) {
    errorEl.textContent = error.message ?? "login failed";
    return;
  }

  window.location.href = "/";
});
