import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

export class TitleSettings {
  public show: boolean = true;
  public text: string = "Filtro";
  public fontSize: number = 14;
}
export class ItemTextSettings {
  public fontSize: number = 12;
  public wrapWidth: number = 260;
  public indent: number = 14;
}
export class SearchSettings {
  public show: boolean = true;
  public placeholder: string = "Pesquisar...";
}

export class VisualSettings {
  public title: TitleSettings = new TitleSettings();
  public itemText: ItemTextSettings = new ItemTextSettings();
  public search: SearchSettings = new SearchSettings();

  static parse<T extends VisualSettings>(dataView: DataView, defaults?: T): T {
    const s = (defaults
      ? Object.assign(new VisualSettings(), defaults)
      : new VisualSettings()) as T;

    const obj = dataView?.metadata?.objects;

    const gv = <TVal>(path: string[], fallback: TVal): TVal => {
      // navega em metadata.objects["obj"]["prop"]
      let cur: any = obj;
      for (const p of path) cur = cur?.[p];
      return (cur as TVal) ?? fallback;
    };

    s.title.show      = gv(["title", "show"], s.title.show);
    s.title.text      = gv(["title", "text"], s.title.text);
    s.title.fontSize  = gv(["title", "fontSize"], s.title.fontSize);

    s.itemText.fontSize = gv(["itemText", "fontSize"], s.itemText.fontSize);
    s.itemText.wrapWidth = gv(["itemText", "wrapWidth"], s.itemText.wrapWidth);
    s.itemText.indent    = gv(["itemText", "indent"], s.itemText.indent);

    s.search.show        = gv(["search", "show"], s.search.show);
    s.search.placeholder = gv(["search", "placeholder"], s.search.placeholder);

    return s;
  }
}
