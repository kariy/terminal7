const SSH_DESTINATION_KEY = "cc-manager:ssh-destination";
const SSH_PASSWORD_KEY = "cc-manager:ssh-password";

export function getSshDestination(): string | null {
  return localStorage.getItem(SSH_DESTINATION_KEY);
}

export function setSshDestination(value: string): void {
  localStorage.setItem(SSH_DESTINATION_KEY, value);
}

export function getSshPassword(): string | null {
  return localStorage.getItem(SSH_PASSWORD_KEY);
}

export function setSshPassword(value: string): void {
  localStorage.setItem(SSH_PASSWORD_KEY, value);
}
