const SHOP_KEY = "space-survival-shop";

export const COIN_REWARDS = {
  basic: 3,
  fast: 4,
  tank: 8,
  boss: 20,
};

export const SHOP_ITEMS = [
  // Ship skins
  {
    id: "ship_default",
    type: "ship",
    icon: "ship-aurora",
    name: "Aurora Hull",
    desc: "Default cyan fighter",
    price: 0,
    ship: { body: "#d6f6ff", core: "#47aaff", glow: "#4bc8ff" },
  },
  {
    id: "ship_crimson",
    type: "ship",
    icon: "ship-blade",
    name: "Crimson Blade",
    desc: "Scarlet strike craft",
    price: 40,
    ship: { body: "#ffe0e6", core: "#ff4d6d", glow: "#ff6b8a" },
  },
  {
    id: "ship_violet",
    type: "ship",
    icon: "ship-phantom",
    name: "Void Phantom",
    desc: "Purple stealth frame",
    price: 55,
    ship: { body: "#f3e8ff", core: "#c084fc", glow: "#e879f9" },
  },
  {
    id: "ship_gold",
    type: "ship",
    icon: "ship-solar",
    name: "Solar Edge",
    desc: "Gold-trimmed interceptor",
    price: 80,
    ship: { body: "#fff7e0", core: "#fbbf24", glow: "#f59e0b" },
  },
  {
    id: "ship_ember",
    type: "ship",
    icon: "ship-ember",
    name: "Ember Lance",
    desc: "Molten orange assault frame",
    price: 95,
    ship: { body: "#ffe8d6", core: "#ff7a18", glow: "#ff9f43" },
  },
  {
    id: "ship_neon",
    type: "ship",
    icon: "ship-neon",
    name: "Neon Drift",
    desc: "Electric teal racer hull",
    price: 110,
    ship: { body: "#e7fff9", core: "#14b8a6", glow: "#2dd4bf" },
  },
  // Enemy skins
  {
    id: "enemy_default",
    type: "enemy",
    icon: "enemy-pack",
    name: "Standard Hostiles",
    desc: "Default enemy colors",
    price: 0,
    enemy: {
      basic: "#ff5577",
      fast: "#ffdf6b",
      tank: "#ffb36b",
      boss: "#ff6b4a",
    },
  },
  {
    id: "enemy_ice",
    type: "enemy",
    icon: "enemy-ice",
    name: "Ice Swarm",
    desc: "Frozen crystal foes",
    price: 50,
    enemy: {
      basic: "#67e8f9",
      fast: "#a5f3fc",
      tank: "#22d3ee",
      boss: "#06b6d4",
    },
  },
  {
    id: "enemy_toxic",
    type: "enemy",
    icon: "enemy-toxic",
    name: "Toxic Horde",
    desc: "Acid-green invaders",
    price: 65,
    enemy: {
      basic: "#86efac",
      fast: "#bef264",
      tank: "#4ade80",
      boss: "#22c55e",
    },
  },
  {
    id: "enemy_shadow",
    type: "enemy",
    icon: "enemy-shadow",
    name: "Shadow Legion",
    desc: "Dark violet raiders",
    price: 90,
    enemy: {
      basic: "#c4b5fd",
      fast: "#a78bfa",
      tank: "#8b5cf6",
      boss: "#7c3aed",
    },
  },
  {
    id: "enemy_solar",
    type: "enemy",
    icon: "enemy-solar",
    name: "Solar Raiders",
    desc: "Burning amber swarm",
    price: 100,
    enemy: {
      basic: "#fdba74",
      fast: "#fcd34d",
      tank: "#fb923c",
      boss: "#f97316",
    },
  },
  // Arena themes / props
  {
    id: "prop_none",
    type: "prop",
    icon: "theme-clear",
    name: "Clear Void",
    desc: "Clean arena, no props",
    price: 0,
    prop: { kind: "none" },
  },
  {
    id: "prop_asteroids",
    type: "prop",
    icon: "theme-rock",
    name: "Asteroid Field",
    desc: "Drifting rocks in the arena",
    price: 35,
    prop: { kind: "asteroids", count: 7, color: "#8b7355" },
  },
  {
    id: "prop_beacons",
    type: "prop",
    icon: "theme-beacon",
    name: "Nav Beacons",
    desc: "Glowing marker buoys",
    price: 45,
    prop: { kind: "beacons", count: 5, color: "#7bc8ff" },
  },
  {
    id: "prop_debris",
    type: "prop",
    icon: "theme-scrap",
    name: "Wreck Debris",
    desc: "Scattered scrap metal",
    price: 30,
    prop: { kind: "debris", count: 10, color: "#9ca3af" },
  },
  {
    id: "prop_rings",
    type: "prop",
    icon: "theme-rings",
    name: "Energy Rings",
    desc: "Soft pulse rings in space",
    price: 70,
    prop: { kind: "rings", count: 4, color: "#c77dff" },
  },
  {
    id: "prop_nebula",
    type: "prop",
    icon: "theme-nebula",
    name: "Nebula Drift",
    desc: "Soft gas clouds as arena props",
    price: 85,
    prop: { kind: "beacons", count: 6, color: "#f0abfc" },
  },
];

function defaultOwned() {
  return SHOP_ITEMS.filter((i) => i.price === 0).map((i) => i.id);
}

export const shop = {
  coins: 0,
  owned: defaultOwned(),
  equipped: {
    ship: "ship_default",
    enemy: "enemy_default",
    prop: "prop_none",
  },

  load() {
    try {
      const raw = localStorage.getItem(SHOP_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.coins === "number") this.coins = Math.max(0, Math.floor(saved.coins));
      if (Array.isArray(saved.owned)) {
        this.owned = [...new Set([...defaultOwned(), ...saved.owned])];
      }
      if (saved.equipped) {
        for (const key of ["ship", "enemy", "prop"]) {
          if (saved.equipped[key] && this.owned.includes(saved.equipped[key])) {
            this.equipped[key] = saved.equipped[key];
          }
        }
      }
    } catch {
      /* ignore */
    }
  },

  save() {
    localStorage.setItem(
      SHOP_KEY,
      JSON.stringify({
        coins: this.coins,
        owned: this.owned,
        equipped: this.equipped,
      }),
    );
  },

  addCoins(n) {
    this.coins += Math.max(0, Math.floor(n));
    this.save();
  },

  owns(id) {
    return this.owned.includes(id);
  },

  buy(id) {
    const item = SHOP_ITEMS.find((i) => i.id === id);
    if (!item) return { ok: false, reason: "missing" };
    if (this.owns(id)) return { ok: false, reason: "owned" };
    if (this.coins < item.price) return { ok: false, reason: "funds" };
    this.coins -= item.price;
    this.owned.push(id);
    this.equipped[item.type] = id;
    this.save();
    return { ok: true };
  },

  equip(id) {
    const item = SHOP_ITEMS.find((i) => i.id === id);
    if (!item || !this.owns(id)) return false;
    this.equipped[item.type] = id;
    this.save();
    return true;
  },

  getEquipped(type) {
    const id = this.equipped[type];
    return SHOP_ITEMS.find((i) => i.id === id) || SHOP_ITEMS.find((i) => i.type === type && i.price === 0);
  },

  itemsByType(type) {
    return SHOP_ITEMS.filter((i) => i.type === type);
  },
};
