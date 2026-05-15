import { API_URL } from "../cli/config.js";
import type { ExtractedFile } from "./parser.js";

export class DistillWriter {
  private apiKey: string;
  private project: string;
  private log: (msg: string) => void;

  constructor(apiKey: string, project: string, log?: (msg: string) => void) {
    this.apiKey = apiKey;
    this.project = project;
    this.log = log ?? (() => {});
  }

  async writeAll(files: ExtractedFile[]): Promise<number> {
    let written = 0;
    for (const file of files) {
      try {
        const res = await fetch(`${API_URL}/api/context/save`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project: this.project,
            path: file.path,
            content: file.content,
            source: "distill",
            tags: file.tags,
          }),
        });

        if (res.ok) {
          written++;
        } else {
          this.log(`Failed to write ${file.path}: ${res.status}`);
        }
      } catch (err) {
        this.log(`Failed to write ${file.path}: ${err}`);
      }
    }
    return written;
  }
}
