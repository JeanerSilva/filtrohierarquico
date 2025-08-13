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
export declare class BehaviorSettings {
    /** Se true, apenas folhas podem ser selecionadas */
    leavesOnly: boolean;
    /** Se true, força seleção única (sempre 1 item selecionado) */
    singleSelect: boolean;
}
export declare class VisualSettings {
    title: TitleSettings;
    itemText: ItemTextSettings;
    search: SearchSettings;
    behavior: BehaviorSettings;
    /**
     * Faz merge dos objetos do metadata sobre o estado atual.
     * Se objects vier undefined, NÃO reseta: devolve 'current' intacto.
     */
    static parse<T extends VisualSettings>(dataView: DataView, current?: T): T;
}
