declare global {
  namespace App {
    interface Locals {
      user: { id: string; email: string } | null;
      token: string | null;
    }
  }
}

export {};
