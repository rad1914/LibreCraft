// Commands system: parse strings like "/time set day", "/creative", etc.
// Returns a command descriptor the engine can execute. Unknown commands
// return an error result so the UI can show a message.

export type CommandResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export interface CommandContext {
  setTime: (t: number) => void;
  toggleCreative: () => void;
  setCreative: (on: boolean) => void;
  heal: () => void;
  teleport: (x: number, y: number, z: number) => void;
  // Spawn a mob of the given type near the player. Returns true on success.
  spawnMob: (type: string) => boolean;
  // Give the player `count` of the block/item named `name`. Returns true
  // on success (name resolved to a known block).
  giveItem: (name: string, count: number) => boolean;
}

// Parse a raw command string (with or without leading "/") and run it
// against the provided context.
export function runCommand(input: string, ctx: CommandContext): CommandResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Empty command" };
  const body = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const parts = body.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "time": {
      if (args.length >= 2 && args[0].toLowerCase() === "set") {
        const v = args[1].toLowerCase();
        if (v === "day") { ctx.setTime(0.25); return { ok: true, message: "Time set to day" }; }
        if (v === "night") { ctx.setTime(0.75); return { ok: true, message: "Time set to night" }; }
        const n = Number(args[1]);
        if (!Number.isNaN(n)) { ctx.setTime(((n % 1) + 1) % 1); return { ok: true, message: `Time set to ${n}` }; }
      }
      return { ok: false, message: "Usage: /time set <day|night|0..1>" };
    }
    case "creative":
      ctx.toggleCreative();
      return { ok: true, message: "Toggled creative mode" };
    case "heal":
      ctx.heal();
      return { ok: true, message: "Healed to full health" };
    case "teleport":
    case "tp": {
      if (args.length < 3) return { ok: false, message: "Usage: /teleport <x> <y> <z>" };
      const x = Number(args[0]);
      const y = Number(args[1]);
      const z = Number(args[2]);
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
        return { ok: false, message: "Coordinates must be numbers" };
      }
      ctx.teleport(x, y, z);
      return { ok: true, message: `Teleported to ${x} ${y} ${z}` };
    }
    case "spawn": {
      // /spawn <entity> — spawns a mob near the player.
      // Supported: pig, cow, sheep, wolf, goblin, shade, dragon, iron_golem, villager
      if (args.length < 1) {
        return { ok: false, message: "Usage: /spawn <pig|cow|sheep|wolf|goblin|shade|dragon|iron_golem|villager>" };
      }
      const type = args[0].toLowerCase();
      const ok = ctx.spawnMob(type);
      return ok
        ? { ok: true, message: `Spawned ${type}` }
        : { ok: false, message: `Unknown entity: ${type}` };
    }
    case "give": {
      // /give <name> [count] — gives the player items.
      // Name matches the block's lowercase name with spaces→underscores
      // (e.g. "stone", "cobblestone", "iron_ore", "wood", "planks").
      if (args.length < 1) {
        return { ok: false, message: "Usage: /give <name> [count]" };
      }
      const name = args[0].toLowerCase();
      const count = args.length >= 2 ? Math.max(1, Math.min(64, Math.floor(Number(args[1]) || 1))) : 1;
      const ok = ctx.giveItem(name, count);
      return ok
        ? { ok: true, message: `Gave ${count} ${name}` }
        : { ok: false, message: `Unknown item: ${name}` };
    }
    case "help":
      return {
        ok: true,
        message: "Commands: /time set day|night, /creative, /heal, /teleport x y z, /spawn <entity>, /give <name> [count]",
      };
    default:
      return { ok: false, message: `Unknown command: /${cmd}` };
  }
}
