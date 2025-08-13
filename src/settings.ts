import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

export class TitleSettings {
  public show: boolean = true;
  public text: string = "Filtro";
  public fontSize: number = 14;
}

export class ItemTextSettings {
  public fontSize: number = 12;
  public wrapWidth: number = 260; // px
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
   * Faz o merge dos objetos do metadata sobre o estado atual.
   * Se objects vier undefined, mantém `current` (não reseta para defaults).
   */
  static parse<T extends VisualSettings>(dataView: DataView, current?: T): T {
    const base = (current
      ? Object.assign(new VisualSettings(), current)
      : new VisualSettings()) as T;

    const objs = dataView?.metadata?.objects;
    if (!objs) {
      // Sem objetos: não sobrescreve o que já está na memória
      return base;
    }

    // helper para buscar valor com fallback preservando o tipo
    const get = <V>(objName: string, prop: string, def: V): V => {
      const o: any = (objs as any)[objName];
      const v = o && prop in o ? (o[prop] as V) : undefined;
      return (v === undefined || v === null) ? def : v;
    };

    // title
    base.title.show     = get("title",   "show",     base.title.show);
    base.title.text     = get("title",   "text",     base.title.text);
    base.title.fontSize = get("title",   "fontSize", base.title.fontSize);

    // itemText
    base.itemText.fontSize  = get("itemText", "fontSize",  base.itemText.fontSize);
    base.itemText.wrapWidth = get("itemText", "wrapWidth", base.itemText.wrapWidth);
    base.itemText.indent    = get("itemText", "indent",    base.itemText.indent);

    // search
    base.search.show        = get("search", "show",        base.search.show);
    base.search.placeholder = get("search", "placeholder", base.search.placeholder);

    // behavior
    base.behavior.leavesOnly  = get("behavior", "leavesOnly",  base.behavior.leavesOnly);
    base.behavior.singleSelect = get("behavior", "singleSelect", base.behavior.singleSelect);

    return base;
  }
}
