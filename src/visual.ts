"use strict";

import powerbi from "powerbi-visuals-api";
import "./../style/visual.less";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

import { VisualSettings } from "./settings";

type Node = {
  key: string;
  value: string;
  level: number;
  identity: ISelectionId | null;     // legado (não usado para selecionar)
  selectionIds: ISelectionId[];      // ✅ ids de TODAS as linhas cobertas por este nó
  children: Node[];
  parentKey?: string;
  // interno (usado só na construção)
  rowSet?: Set<number>;
};

export class Visual implements IVisual {
  private target!: HTMLElement;
  private container!: HTMLElement;
  private titleEl!: HTMLElement;
  private searchWrap!: HTMLDivElement;
  private treeWrap!: HTMLDivElement;

  private host!: powerbi.extensibility.visual.IVisualHost;
  private selectionManager!: ISelectionManager;
  private settings: VisualSettings = new VisualSettings();

  private allNodes: Node[] = [];
  private filteredNodes: Node[] = [];

  // estado para seleção única
  private currentSelectedKey: string | null = null;

  constructor(options?: VisualConstructorOptions) {
    this.host = options!.host;
    this.selectionManager = this.host.createSelectionManager();
    this.target = options!.element;

    // Root container
    this.container = document.createElement("div");
    this.container.className = "hf__root";
    this.target.appendChild(this.container);

    // Title
    this.titleEl = document.createElement("div");
    this.titleEl.className = "hf__title";
    this.container.appendChild(this.titleEl);

    // Search
    this.searchWrap = document.createElement("div");
    this.searchWrap.className = "hf__search";
    this.container.appendChild(this.searchWrap);

    // Tree
    this.treeWrap = document.createElement("div");
    this.treeWrap.className = "hf__tree";
    this.container.appendChild(this.treeWrap);
  }

  public update(options: VisualUpdateOptions): void {
    const dataView = options.dataViews && options.dataViews[0];
    if (!dataView) return;

    // ⚠️ não resetar formatações quando metadata.objects vier vazio (evento transitório)
    if (dataView.metadata && dataView.metadata.objects) {
      this.settings = VisualSettings.parse<VisualSettings>(dataView, this.settings);
    }

    // Title
    this.titleEl.style.display = this.settings.title.show ? "block" : "none";
    this.titleEl.textContent = this.settings.title.text;
    this.titleEl.style.fontSize = `${this.settings.title.fontSize}px`;

    // Search
    this.renderSearch();

    // Data -> Tree (constrói ids de seleção por nó)
    this.allNodes = this.buildTree(dataView);
    this.filteredNodes = this.allNodes;

    // Render
    this.renderTree();
    this.ensureSingleSelected(); // garante sempre 1 seleção no modo single
  }

  // ---------------- helpers ----------------

  private blankSelector(): powerbi.data.Selector {
    // Necessário para typings da API em enumerateObjectInstances
    return {} as powerbi.data.Selector;
  }

  private clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  private isSelectable(node: Node): boolean {
    const isLeaf = !node.children || node.children.length === 0;
    const leavesOnly = this.settings.behavior.leavesOnly;
    return (node.selectionIds && node.selectionIds.length > 0) && (isLeaf || !leavesOnly);
  }

  private findFirstSelectable(nodes: Node[]): Node | null {
    for (const n of nodes) {
      if (this.isSelectable(n)) return n;
      if (n.children?.length) {
        const hit = this.findFirstSelectable(n.children);
        if (hit) return hit;
      }
    }
    return null;
  }

  private ensureSingleSelected(): void {
    if (!this.settings.behavior.singleSelect) return;

    // Se o item atual não está mais no DOM (após filtro/atualização), escolha o primeiro válido
    const stillThere =
      this.currentSelectedKey &&
      this.treeWrap.querySelector(`input[data-key="${this.currentSelectedKey}"]`);

    if (!stillThere) {
      const first = this.findFirstSelectable(this.filteredNodes);
      if (first) {
        this.currentSelectedKey = first.key;

        const el = this.treeWrap.querySelector<HTMLInputElement>(
          `input[data-key="${first.key}"]`
        );
        if (el) el.checked = true;

        if (first.selectionIds?.length) {
          void this.selectionManager.select(first.selectionIds, false);
        }
      }
    }
  }

  // --------------- data build ----------------

  // Constrói a floresta de nós a partir das colunas de categoria,
  // usando um "category base" (o primeiro que tiver identity) para gerar selectionIds por linha.
  private buildTree(dataView: DataView): Node[] {
    const cat = dataView.categorical?.categories;
    if (!cat || cat.length === 0) return [];

    // encontre o primeiro category com identity (será usado para todos os selectionIds)
    const baseIdx = cat.findIndex(c => Array.isArray((c as any).identity) && (c as any).identity.length > 0);
    const baseCat = baseIdx >= 0 ? cat[baseIdx] : null;

    const len = cat[0].values.length;
    const nodeByKey = new Map<string, Node>();
    const roots: Node[] = [];

    for (let row = 0; row < len; row++) {
      let parentKey: string | undefined = undefined;

      for (let lvl = 0; lvl < cat.length; lvl++) {
        const value = String(cat[lvl].values[row] ?? "");
        // chave determinística por posição
        const key = `${lvl}::${value}::${row}`;

        let node = nodeByKey.get(key);
        if (!node) {
          // identity legado (não confiável entre colunas) — mantemos por compatibilidade
          const legacyIdentity =
            cat[lvl].identity
              ? this.host.createSelectionIdBuilder().withCategory(cat[lvl], row).createSelectionId()
              : null;

          node = {
            key,
            value,
            level: lvl,
            identity: legacyIdentity,
            selectionIds: [],
            rowSet: new Set<number>(),
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

        // agregue as linhas (selectionIds) sob este nó
        if (baseCat && !node.rowSet!.has(row)) {
          node.rowSet!.add(row);
          const selId = this.host.createSelectionIdBuilder()
            .withCategory(baseCat, row)
            .createSelectionId();
          node.selectionIds.push(selId);
        }

        parentKey = key;
      }
    }

    // limpeza
    nodeByKey.forEach(n => { delete n.rowSet; });
    return roots;
  }

  // --------------- UI render ----------------

  private renderSearch() {
    this.clearElement(this.searchWrap);
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
      this.ensureSingleSelected();
    });

    this.searchWrap.appendChild(input);
  }

  private filterTree(nodes: Node[], q: string): Node[] {
    const match = (v: string) => v.toLowerCase().indexOf(q) !== -1;

    const dfs = (node: Node): Node | null => {
      const matched = match(node.value);
      const children = node.children
        .map(child => dfs(child))
        .filter((x): x is Node => !!x);

      if (matched || children.length > 0) {
        return { ...node, children };
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
    this.clearElement(this.treeWrap);

    const renderNode = (node: Node, container: HTMLElement) => {
      const isLeaf = !node.children || node.children.length === 0;

      const row = document.createElement("div");
      row.className = "hf__row";
      row.style.paddingLeft = `${node.level * (this.settings.itemText.indent || 14)}px`;

      // input aparece se for folha OU se leavesOnly=false
      const showInput = (isLeaf || !this.settings.behavior.leavesOnly) && node.selectionIds.length > 0;

      // radio para seleção única; checkbox caso contrário
      const inputType = this.settings.behavior.singleSelect ? "radio" : "checkbox";

      let inputEl: HTMLInputElement | null = null;
      if (showInput) {
        const inp = document.createElement("input");
        inp.type = inputType;
        if (inputType === "radio") inp.name = "hf-single-select-group";
        inp.className = "hf__chk";
        inp.dataset.key = node.key;

        // respeitar seleção atual
        if (this.settings.behavior.singleSelect && this.currentSelectedKey === node.key) {
          inp.checked = true;
        }

        inputEl = inp;
        row.appendChild(inp);
      }

      const label = document.createElement("label");
      label.className = "hf__lbl";
      label.textContent = node.value;
      label.style.fontSize = `${this.settings.itemText.fontSize}px`;
      label.style.maxWidth = `${this.settings.itemText.wrapWidth}px`;
      row.appendChild(label);

      container.appendChild(row);

      if (showInput) {
        const selectHandler = () => {
          const ids = node.selectionIds;
          if (!ids || ids.length === 0) return;

          if (this.settings.behavior.singleSelect) {
            // desmarcar anterior na UI
            if (this.currentSelectedKey && this.currentSelectedKey !== node.key) {
              const prev = this.treeWrap.querySelector<HTMLInputElement>(
                `input[data-key="${this.currentSelectedKey}"]`
              );
              if (prev) prev.checked = false;
            }
            this.currentSelectedKey = node.key;

            // substitui seleção
            void this.selectionManager.select(ids, false);
          } else {
            // múltipla
            void this.selectionManager.select(ids, true);
          }
        };

        inputEl!.addEventListener("change", selectHandler);

        row.addEventListener("click", (e) => {
          const t = (e.target as HTMLElement).tagName.toLowerCase();
          if (t !== "input" && inputEl) {
            if (inputEl.type === "radio") {
              inputEl.checked = true; // rádio não pode ficar “sem nada”
            } else {
              inputEl.checked = !inputEl.checked;
            }
            selectHandler();
          }
        });
      } else {
        row.style.cursor = "default";
      }

      if (node.children?.length) {
        const kids = document.createElement("div");
        kids.className = "hf__kids";
        container.appendChild(kids);
        node.children.forEach(child => renderNode(child, kids));
      }
    };

    this.filteredNodes.forEach(n => renderNode(n, this.treeWrap));
  }

  // --------------- formatação (painel) ----------------

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

      case "behavior":
        instances.push({
          objectName: "behavior",
          selector: this.blankSelector(),
          properties: {
            leavesOnly: this.settings.behavior.leavesOnly,
            singleSelect: this.settings.behavior.singleSelect
          }
        });
        break;
    }

    return instances;
  }
}
