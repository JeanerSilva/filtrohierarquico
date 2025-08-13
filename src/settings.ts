// src/settings.ts
import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

export class TitleSettings {
  public show: boolean = true;
  public text: string = "Filtro";
  public fontSize: number = 14;
}

export class ItemTextSettings {
  public fontSize: number = 16;   // controla também a UI (input/botões) via visual.ts
  public wrapWidth: number = 1260; // px
  public indent: number = 14;     // px por nível
}

export class SearchSettings {
  public show: boolean = true;
  public placeholder: string = "Pesquisar...";
}

export class BehaviorSettings {
  /** Se true, apenas folhas podem ser selecionadas */
  public leavesOnly: boolean = false;
  /** Se true, força seleção única (sempre 1 item selecionado) */
  public singleSelect: boolean = false;
}

export class VisualSettings {
  public title: TitleSettings = new TitleSettings();
  public itemText: ItemTextSettings = new ItemTextSettings();
  public search: SearchSettings = new SearchSettings();
  public behavior: BehaviorSettings = new BehaviorSettings();

  /**
   * Faz merge dos objetos do metadata sobre o estado atual.
   * Se objects vier undefined, NÃO reseta: devolve 'current' intacto.
   */
  static parse<T extends VisualSettings>(dataView: DataView, current?: T): T {
  // comece do estado atual (se existir), senão dos defaults
  const base = (current ? deepClone(current) : (new VisualSettings() as any)) as T;

  const objs = dataView?.metadata?.objects;
  if (!objs) return base; // ← preserva o que já estava setado

    // helpers
    const has = (o: any, p: string) => o && Object.prototype.hasOwnProperty.call(o, p);
    const num = (v: any, fallback: number) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const bool = (v: any, fallback: boolean) =>
      typeof v === "boolean" ? v : fallback;
    const text = (v: any, fallback: string) =>
      typeof v === "string" ? v : (v == null ? fallback : String(v));

    // title
    if (has(objs, "title")) {
      const o: any = (objs as any).title;
      if (has(o, "show"))     base.title.show     = bool(o.show, base.title.show);
      if (has(o, "text"))     base.title.text     = text(o.text, base.title.text);
      if (has(o, "fontSize")) base.title.fontSize = num(o.fontSize, base.title.fontSize);
    }

    // itemText
    if (has(objs, "itemText")) {
      const o: any = (objs as any).itemText;
      if (has(o, "fontSize"))  base.itemText.fontSize  = num(o.fontSize, base.itemText.fontSize);
      if (has(o, "wrapWidth")) base.itemText.wrapWidth = num(o.wrapWidth, base.itemText.wrapWidth);
      if (has(o, "indent"))    base.itemText.indent    = num(o.indent, base.itemText.indent);
    }

    // search
    if (has(objs, "search")) {
      const o: any = (objs as any).search;
      if (has(o, "show"))        base.search.show        = bool(o.show, base.search.show);
      if (has(o, "placeholder")) base.search.placeholder = text(o.placeholder, base.search.placeholder);
    }

    // behavior
    if (has(objs, "behavior")) {
      const o: any = (objs as any).behavior;
      if (has(o, "leavesOnly"))  base.behavior.leavesOnly  = bool(o.leavesOnly, base.behavior.leavesOnly);
      if (has(o, "singleSelect")) base.behavior.singleSelect = bool(o.singleSelect, base.behavior.singleSelect);
    }

    return base;
  }
}

/** clone raso suficiente para nosso objeto plano */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
