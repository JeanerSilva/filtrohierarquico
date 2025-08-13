import "core-js/stable";
import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
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
    private currentSelectedKey;
    constructor(options?: VisualConstructorOptions);
    private clearElement;
    private static parseSettings;
    private buildTree;
    private renderSearch;
    private filterTree;
    private renderTree;
    private blankSelector;
    update(options: VisualUpdateOptions): void;
    enumerateObjectInstances(options: powerbi.EnumerateVisualObjectInstancesOptions): powerbi.VisualObjectInstanceEnumeration;
}
