/**
 * Хранилище на диске компьютера: сохранённые ответы сервера и очередь правок.
 *
 * Всё зашифровано ключом учётной записи Windows (`safeStorage` - это DPAPI):
 * файл, унесённый на другой компьютер или открытый другим пользователем
 * Windows, не читается. В реестре договоров суммы и стороны - не то, что
 * можно оставлять открытым текстом в папке профиля.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { safeStorage } from "electron";

export class Vault {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  /** Имя файла по ключу: ключи бывают адресами с `?` и `/`. */
  private file(scope: string, key: string): string {
    const name = createHash("sha256").update(key).digest("hex").slice(0, 40);
    return path.join(this.root, scope, name);
  }

  read(scope: string, key: string): string | null {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(this.file(scope, key));
    } catch {
      return null;
    }
    try {
      return safeStorage.decryptString(raw);
    } catch {
      // Чужой ключ (профиль перенесли) или битый файл: прочитать нельзя - и не нужно.
      return null;
    }
  }

  /** Запись через временный файл: выключенный посреди записи компьютер не оставит половину. */
  write(scope: string, key: string, text: string): void {
    const target = this.file(scope, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, safeStorage.encryptString(text));
    fs.renameSync(temp, target);
  }

  remove(scope: string, key: string): void {
    fs.rmSync(this.file(scope, key), { force: true });
  }

  /** Вся папка - например, сохранённое учётки, которая вышла. */
  drop(scope: string): void {
    fs.rmSync(path.join(this.root, scope), { recursive: true, force: true });
  }

  scopes(parent: string): string[] {
    try {
      return fs.readdirSync(path.join(this.root, parent));
    } catch {
      return [];
    }
  }
}
