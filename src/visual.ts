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
  key: string;                 // chave única do caminho (ex.: "0:Eixo 1|1:1.1 ...")
  value: string;               // texto do nível atual
  level: number;               // 0,1,2...
  identity: ISelectionId | null;   // legado (não usamos para selecionar)
  selectionIds: ISelectionId[];    // TODAS as linhas sob este nó
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
  private selectionManager!: ISelectionManager;
  private settings: VisualSettings = new VisualSettings();

  private allNodes: Node[] = [];
  private filteredNodes: Node[] = [];

  // expansão por nó
  private expandedKeys = new Set<string>();

  // seleção estável (evita travamentos)
  private selectedNodeKeys = new Set<string>();

  // modo single: lembramos o atual para marcar o radio
  private currentSelectedKey: string | null = null;

  constructor(options?: VisualConstructorOptions) {
    this.host = options!.host;
    this.selectionManager = this.host.createSelectionManager();
    this.target = options!.element;

    // Root
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

  // ⚠️ Só parseia quando há objetos; caso contrário, preserva o estado atual
  if (dataView.metadata?.objects) {
    this.settings = VisualSettings.parse<VisualSettings>(dataView, this.settings);
  }

  // aplique aqui o que usa settings (fonte, título etc)
  this.container.style.fontSize = `${this.settings.itemText.fontSize}px`;
  this.titleEl.style.display = this.settings.title.show ? "block" : "none";
  this.titleEl.textContent = this.settings.title.text;
  this.titleEl.style.fontSize = `${this.settings.title.fontSize}px`;

    // Search
    this.renderSearch();

    // Data -> Tree (sem duplicatas; com selectionIds)
    this.allNodes = this.buildTree(dataView);
    this.filteredNodes = this.allNodes;

    // abra raízes pelo menos uma vez
    if (this.expandedKeys.size === 0) {
      this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
    }

    // Render
    this.renderTree();
    this.ensureSingleSelected();
    this.applySelection();
  }

  // ---------------- helpers ----------------

  private clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  private isSelectable(node: Node): boolean {
    const isLeaf = !node.children || node.children.length === 0;
    return (node.selectionIds.length > 0) && (isLeaf || !this.settings.behavior.leavesOnly);
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

  private nodeIsSelected(nodeKey: string): boolean {
    return this.selectedNodeKeys.has(nodeKey);
  }

  private collectSelectedIds(): ISelectionId[] {
    const bag: ISelectionId[] = [];
    const walk = (list: Node[]) => {
      for (const n of list) {
        if (this.selectedNodeKeys.has(n.key)) {
          for (const id of n.selectionIds) bag.push(id);
        }
        if (n.children?.length) walk(n.children);
      }
    };
    walk(this.filteredNodes);
    return bag;
  }

  // aplica uma seleção completa (sem merge) → evita resíduos/travamentos
  private applySelection(): void {
    const all = this.collectSelectedIds();
    if (all.length === 0) {
      void this.selectionManager.clear();
    } else {
      void this.selectionManager.select(all, false);
    }
  }

  private ensureSingleSelected(): void {
    if (!this.settings.behavior.singleSelect) return;

    if (this.selectedNodeKeys.size === 0) {
      const first = this.findFirstSelectable(this.filteredNodes);
      if (first) {
        this.selectedNodeKeys.add(first.key);
        this.currentSelectedKey = first.key;

        // marca radio no DOM
        const el = this.treeWrap.querySelector<HTMLInputElement>(`input[data-key="${first.key}"]`);
        if (el) el.checked = true;
      }
    }
  }

  // ---------------- data build (agrupa por caminho) ----------------

  private buildTree(dataView: DataView): Node[] {
    const cat = dataView.categorical?.categories;
    if (!cat || cat.length === 0) return [];

    // category base com identity (para gerar SelectionIds)
    const baseIdx = cat.findIndex(c => Array.isArray((c as any).identity) && (c as any).identity.length > 0);
    const baseCat = baseIdx >= 0 ? cat[baseIdx] : null;

    const len = cat[0].values.length;

    const nodeByPath = new Map<string, Node>();
    const roots: Node[] = [];
    const norm = (v: any) => String(v ?? "");

    const pathKeyUpTo = (row: number, lvl: number) => {
      const parts: string[] = [];
      for (let i = 0; i <= lvl; i++) parts.push(`${i}:${norm(cat[i].values[row])}`);
      return parts.join("|");
    };

    for (let row = 0; row < len; row++) {
      let parentPath: string | undefined = undefined;

      for (let lvl = 0; lvl < cat.length; lvl++) {
        const value = norm(cat[lvl].values[row]);
        const path = pathKeyUpTo(row, lvl);

        let node = nodeByPath.get(path);
        if (!node) {
          const legacyIdentity =
            cat[lvl].identity
              ? this.host.createSelectionIdBuilder().withCategory(cat[lvl], row).createSelectionId()
              : null;

          node = {
            key: path,
            value,
            level: lvl,
            identity: legacyIdentity,
            selectionIds: [],
            children: [],
            parentKey: parentPath
          };
          nodeByPath.set(path, node);

          if (lvl === 0) {
            roots.push(node);
          } else if (parentPath) {
            const parent = nodeByPath.get(parentPath);
            if (parent) parent.children.push(node);
          }
        }

        if (baseCat) {
          const selId = this.host.createSelectionIdBuilder()
            .withCategory(baseCat, row)
            .createSelectionId();

          // evita duplicar ids (equals disponível nas typings recentes)
          if (!node.selectionIds.some(s => (s as any).equals ? (s as any).equals(selId) : false)) {
            node.selectionIds.push(selId);
          }
        }

        parentPath = path;
      }
    }

    return roots;
  }

  // ---------------- UI ----------------

  private renderSearch(): void {
    this.clearElement(this.searchWrap);
    if (!this.settings.search.show) return;

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "4px";
    wrap.style.alignItems = "center";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "hf__search__input";
    input.placeholder = this.settings.search.placeholder || "Pesquisar...";
    input.style.flex = "1";

    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            this.filteredNodes = this.allNodes;
        } else {
            this.filteredNodes = this.filterTree(this.allNodes, q);
        }

        // abrir raízes no novo conjunto
        if (this.expandedKeys.size === 0) {
            this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
        }

        this.renderTree();
        this.ensureSingleSelected();
        this.applySelection();
    });

    // Botão de limpar
    // Botão de limpar
const clearBtn = document.createElement("button");
clearBtn.textContent = "✕";
clearBtn.title = "Limpar filtro e seleção";
clearBtn.style.cursor = "pointer";

clearBtn.addEventListener("click", () => {
  // 1) limpa texto e restaura a lista
  input.value = "";
  this.filteredNodes = this.allNodes;

  // (opcional) garantir raízes abertas
  if (this.expandedKeys.size === 0) {
    this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
  }

  // 2) zera seleção atual
  this.selectedNodeKeys.clear();
  this.currentSelectedKey = null;

  // 3) se for seleção única, escolhe o primeiro selecionável
  if (this.settings.behavior.singleSelect) {
    const first = this.findFirstSelectable(this.filteredNodes);
    if (first) {
      this.selectedNodeKeys.add(first.key);
      this.currentSelectedKey = first.key; // só para refletir no rádio
    }
  }

  // 4) re-render e aplica a seleção completa
  this.renderTree();
  this.applySelection();
});


    wrap.appendChild(input);
    wrap.appendChild(clearBtn);
    this.searchWrap.appendChild(wrap);
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

  private renderTree(): void {
    this.clearElement(this.treeWrap);

    const renderNode = (node: Node, container: HTMLElement) => {
      const isLeaf = !node.children || node.children.length === 0;
      const isExpanded = this.expandedKeys.has(node.key);

      const row = document.createElement("div");
      row.className = "hf__row";
      row.style.paddingLeft = `${node.level * (this.settings.itemText.indent || 14)}px`;

      // caret
      if (node.children?.length) {
        const caret = document.createElement("span");
        caret.className = "hf__caret";
        caret.textContent = isExpanded ? "▾" : "▸";
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isExpanded) this.expandedKeys.delete(node.key);
          else this.expandedKeys.add(node.key);
          this.renderTree();
          this.ensureSingleSelected();
          this.applySelection();
        });
        row.appendChild(caret);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "hf__caret --empty";
        row.appendChild(spacer);
      }

      // input (checkbox/radio)
      const showInput = this.isSelectable(node);
      const inputType = this.settings.behavior.singleSelect ? "radio" : "checkbox";
      let inputEl: HTMLInputElement | null = null;

      if (showInput) {
        const inp = document.createElement("input");
        inp.type = inputType;
        if (inputType === "radio") inp.name = "hf-single-select-group";
        inp.className = "hf__chk";
        inp.dataset.key = node.key;

        // estado visual com base no set
        inp.checked = this.nodeIsSelected(node.key);

        inputEl = inp;
        row.appendChild(inp);
      }

      // label
      const label = document.createElement("label");
      label.className = "hf__lbl";
      label.textContent = node.value;
      label.style.maxWidth = `${this.settings.itemText.wrapWidth}px`;
      row.appendChild(label);

      container.appendChild(row);

      // seleção
      if (showInput) {
        const toggleAndApply = () => {
          if (this.settings.behavior.singleSelect) {
            this.selectedNodeKeys.clear();
            this.selectedNodeKeys.add(node.key);
            this.currentSelectedKey = node.key;
          } else {
            if (this.selectedNodeKeys.has(node.key)) {
              this.selectedNodeKeys.delete(node.key);
            } else {
              this.selectedNodeKeys.add(node.key);
            }
          }

          // sincroniza UI do próprio input
          if (inputEl!.type === "radio") inputEl!.checked = true;
          else inputEl!.checked = this.selectedNodeKeys.has(node.key);

          // aplica seleção completa (evita resíduos)
          this.applySelection();
        };

        inputEl!.addEventListener("change", toggleAndApply);

        row.addEventListener("click", (e) => {
          const t = (e.target as HTMLElement).tagName.toLowerCase();
          if (t !== "input") {
            if (inputEl!.type === "radio") inputEl!.checked = true;
            else inputEl!.checked = !inputEl!.checked;
            toggleAndApply();
          }
        });
      } else {
        row.style.cursor = "default";
      }

      // filhos
      if (node.children?.length) {
        const kids = document.createElement("div");
        kids.className = "hf__kids";
        container.appendChild(kids);

        if (isExpanded) {
          node.children.forEach(child => renderNode(child, kids));
        }
      }
    };

    this.filteredNodes.forEach(n => renderNode(n, this.treeWrap));
  }

  // ---------------- painel de formatação ----------------

  public enumerateObjectInstances(
  options: powerbi.EnumerateVisualObjectInstancesOptions
): powerbi.VisualObjectInstanceEnumeration {
  const instances: powerbi.VisualObjectInstance[] = [];

  // helper: empurra um objeto SEM selector, fazendo cast para satisfazer o TS
  const push = (o: any) => {
    instances.push(o as unknown as powerbi.VisualObjectInstance);
  };

  switch (options.objectName) {
    case "title":
      push({
        objectName: "title",
        properties: {
          show: this.settings.title.show,
          text: this.settings.title.text,
          fontSize: this.settings.title.fontSize
        }
      });
      break;

    case "itemText":
      push({
        objectName: "itemText",
        properties: {
          fontSize: this.settings.itemText.fontSize,
          wrapWidth: this.settings.itemText.wrapWidth,
          indent: this.settings.itemText.indent
        }
      });
      break;

    case "search":
      push({
        objectName: "search",
        properties: {
          show: this.settings.search.show,
          placeholder: this.settings.search.placeholder
        }
      });
      break;

    case "behavior":
      push({
        objectName: "behavior",
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
