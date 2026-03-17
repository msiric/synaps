// Fixture: class extending UserService with super.method() calls
import { UserService } from "./service.js";

export class AdminService extends UserService {
  async fetch(id: string): Promise<string> {
    // Calls parent method via super
    const result = await super.fetch(id);
    return this.addAdminPrefix(result);
  }

  private addAdminPrefix(value: string): string {
    return `admin:${value}`;
  }
}
