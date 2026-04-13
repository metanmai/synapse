declare global {
  namespace App {
    interface Error {
      message: string;
      detail?: string;
    }

    interface Locals {
      user: { id: string; email: string; providers: string[] } | null;
      token: string | null;
    }
  }
}

export {};
