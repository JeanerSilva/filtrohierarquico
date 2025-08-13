import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
export declare class Visual implements IVisual {
    private target;
    private container;
    private titleEl;
    private searchWrap;
    private treeWrap;
    private host;
    private selectionManager;
    private settings;
    private allNodes;
    private filteredNodes;
    private expandedKeys;
    private selectedNodeKeys;
    private currentSelectedKey;
    private searchQuery;
    private lastAppliedSig;
    private allowAutoPick;
    private lastDataSig;
    constructor(options?: VisualConstructorOptions);
    update(options: VisualUpdateOptions): void;
    private clearElement;
    private walkNodes;
    private isSelectable;
    private findFirstSelectable;
    private collectSelectedIds;
    private selectionSignature;
    private dataSignature;
    /**
     * Aplica seleção ao host:
     * - Em update externo (force=false) e seleção local vazia → NÃO limpa o host.
     * - Em ações do usuário (force=true) → "quem clicou manda": replace (merge=false).
     */
    private applySelection;
    private ensureSingleSelected;
    private buildTree;
    private renderSearch;
    private filterTree;
    private renderTree;
    enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration;
}
