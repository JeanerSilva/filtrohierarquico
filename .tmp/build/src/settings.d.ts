import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
export declare class TitleSettings {
    show: boolean;
    text: string;
    fontSize: number;
}
export declare class ItemTextSettings {
    fontSize: number;
    wrapWidth: number;
    indent: number;
}
export declare class SearchSettings {
    show: boolean;
    placeholder: string;
}
export declare class VisualSettings {
    title: TitleSettings;
    itemText: ItemTextSettings;
    search: SearchSettings;
    static parse<T extends VisualSettings>(dataView: DataView, defaults?: T): T;
}
