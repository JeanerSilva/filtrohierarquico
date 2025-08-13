"use strict";

import "core-js/stable";
import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;

import { VisualSettings } from "./settings";

type Node = {
  key: string;
  value: string;
  level: number;
  identity: ISelectionId | null;
  children: Node[];
  parentKey?: string;
};

export class Visual implements IVisual {
  private target!: HTMLElement;
  private container!: HTMLElement;
  private titleEl!: HTMLElement;
  private searchWrap!: HTMLDivElement;
  private treeWrap!: HTMLDivElement;

  private host!: powerbi.extensibility.visual.IVisualHost;
  private selectionManager!: powerbi.extensibility.ISelectionManager;
  private settings: VisualSettings = new VisualSettings();

  // TIPAR evita 'never[]'
  private allNodes: Node[] = [];
  private filteredNodes: Node[] = [];


    constructor(options?: VisualConstructorOptions) {
    this.host = options!.host;
    this.selectionManager = this.host.createSelectionManager();
    this.target = options!.element;

    this.container = document.createElement("div");
    this.container.className = "hf__root";
    this.target.appendChild(this.container);

    this.titleEl = document.createElement("div");
    this.titleEl.className = "hf__title";
    this.container.appendChild(this.titleEl);

    this.searchWrap = document.createElement("div");
    this.searchWrap.className = "hf__search";
    this.container.appendChild(this.searchWrap);

    this.treeWrap = document.createElement("div");
    this.treeWrap.className = "hf__tree";
    this.container.appendChild(this.treeWrap);
  }

  private clearElement(el: HTMLElement): void {
    // em vez de el.innerHTML = ""
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }


  private static parseSettings(dataView: DataView, current: VisualSettings): VisualSettings {
    const settings = VisualSettings.parse<VisualSettings>(dataView) as VisualSettings;
    // defaults fallback
    settings.title = Object.assign(new VisualSettings().title, settings.title);
    settings.itemText = Object.assign(new VisualSettings().itemText, settings.itemText);
    settings.search = Object.assign(new VisualSettings().search, settings.search);
    return settings;
  }

  // Build a forest (level-0 nodes) from multiple category columns
  private buildTree(dataView: DataView): Node[] {
    const cat = dataView.categorical?.categories;
    if (!cat || cat.length === 0) return [];

    // Cada coluna de categoria representa um nível da hierarquia
    const levels = cat.length;

    // Vamos percorrer linha a linha para montar pai->filho usando índices
    const len = cat[0].values.length;
    const keyOf = (lvl: number, idx: number) => `${lvl}::${cat[lvl].values[idx] ?? "__BLANK__"}::${idx}`;

    // armazenar nós por chave
    const nodeByKey = new Map<string, Node>();
    const roots: Node[] = [];

    for (let row = 0; row < len; row++) {
      let parentKey: string | undefined = undefined;

      for (let lvl = 0; lvl < levels; lvl++) {
        const value = String(cat[lvl].values[row] ?? "");
        const key = `${lvl}::${value}::${cat[0].identity ? (cat[0].identity[row] as any).key : row}`;

        if (!nodeByKey.has(key)) {
          const identity = cat[lvl].identity ? this.host.createSelectionIdBuilder()
            .withCategory(cat[lvl], row)
            .createSelectionId() : null;

          const node: Node = {
            key,
            value,
            level: lvl,
            identity,
            children: [],
            parentKey
          };
          nodeByKey.set(key, node);

          if (lvl === 0) {
            roots.push(node);
          } else if (parentKey && nodeByKey.has(parentKey)) {
            nodeByKey.get(parentKey)!.children.push(node);
          }
        }

        parentKey = key;
      }
    }

    return roots;
  }

  private renderSearch() {
    this.clearElement(this.searchWrap); // <- no lugar de innerHTML = ""
    if (!this.settings.search.show) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "hf__search__input";
    input.placeholder = this.settings.search.placeholder || "Pesquisar...";

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        this.filteredNodes = this.allNodes;
      } else {
        this.filteredNodes = this.filterTree(this.allNodes, q);
      }
      this.renderTree();
    });

    this.searchWrap.appendChild(input);
  }

  private filterTree(nodes: Node[], q: string): Node[] {
    const match = (v: string) => v.toLowerCase().indexOf(q) !== -1;

    const dfs = (node: Node): Node | null => {
      const matched = match(node.value);
      const children = node.children
        .map(child => dfs(child))
        .filter(Boolean) as Node[];
      if (matched || children.length > 0) {
        return {
          ...node,
          children
        };
      }
      return null;
    };

    const res: Node[] = [];
    for (const n of nodes) {
      const x = dfs(n);
      if (x) res.push(x);
    }
    return res;
  }

  private renderTree() {
    this.clearElement(this.treeWrap); // <- no lugar de innerHTML = ""

    const renderNode = (node: Node, container: HTMLElement) => {
      const row = document.createElement("div");
      row.className = "hf__row";

      row.style.paddingLeft = `${node.level * (this.settings.itemText.indent || 14)}px`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "hf__chk";

      const label = document.createElement("label");
      label.className = "hf__lbl";
      label.textContent = node.value;
      label.style.fontSize = `${this.settings.itemText.fontSize}px`;
      label.style.maxWidth = `${this.settings.itemText.wrapWidth}px`;

      row.appendChild(checkbox);
      row.appendChild(label);
      container.appendChild(row);

      const selectHandler = () => {
        if (node.identity) {
          void this.selectionManager.select(node.identity, true);
        }
      };
      checkbox.addEventListener("change", selectHandler);
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() !== "input") {
          checkbox.checked = !checkbox.checked;
          selectHandler();
        }
      });

      if (node.children?.length) {
        const kids = document.createElement("div");
        kids.className = "hf__kids";
        container.appendChild(kids);
        node.children.forEach(child => renderNode(child, kids));
      }
    };

    this.filteredNodes.forEach(n => renderNode(n, this.treeWrap));
  }

  private blankSelector(): powerbi.data.Selector {
    return {} as powerbi.data.Selector;
  }

public update(options: VisualUpdateOptions): void {
    const dataView = options.dataViews && options.dataViews[0];
    if (!dataView) return;

    // Settings
    this.settings = VisualSettings.parse<VisualSettings>(dataView, this.settings);

    // Title
    this.titleEl.style.display = this.settings.title.show ? "block" : "none";
    this.titleEl.textContent = this.settings.title.text;
    this.titleEl.style.fontSize = `${this.settings.title.fontSize}px`;

    // Search
    this.renderSearch();

    // Data -> Tree
    this.allNodes = this.buildTree(dataView);
    this.filteredNodes = this.allNodes;
    this.renderTree();
  }

  public enumerateObjectInstances(
    options: powerbi.EnumerateVisualObjectInstancesOptions
  ): powerbi.VisualObjectInstanceEnumeration {
    const instances: powerbi.VisualObjectInstance[] = [];

    switch (options.objectName) {
      case "title":
        instances.push({
          objectName: "title",
          selector: this.blankSelector(),
          properties: {
            show: this.settings.title.show,
            text: this.settings.title.text,
            fontSize: this.settings.title.fontSize
          }
        });
        break;

      case "itemText":
        instances.push({
          objectName: "itemText",
          selector: this.blankSelector(),
          properties: {
            fontSize: this.settings.itemText.fontSize,
            wrapWidth: this.settings.itemText.wrapWidth,
            indent: this.settings.itemText.indent
          }
        });
        break;

      case "search":
        instances.push({
          objectName: "search",
          selector: this.blankSelector(),
          properties: {
            show: this.settings.search.show,
            placeholder: this.settings.search.placeholder
          }
        });
        break;
    }

    return instances;
  }


}
