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
  key: string;                // caminho único: "0:Eixo|1:Objetivo|2:Indicador"
  value: string;              // rótulo do nível atual
  level: number;              // 0,1,2...
  identity: ISelectionId | null; // legado; não usamos para selecionar
  selectionIds: ISelectionId[];  // TODAS as linhas sob este nó (IDs da coluna mais profunda)
  children: Node[];
  parentKey?: string;
};

export class Visual implements IVisual {
  // elementos
  private target!: HTMLElement;
  private container!: HTMLElement;
  private titleEl!: HTMLElement;
  private searchWrap!: HTMLDivElement;
  private treeWrap!: HTMLDivElement;

  // host
  private host!: powerbi.extensibility.visual.IVisualHost;
  private selectionManager!: ISelectionManager;

  // settings
  private settings: VisualSettings = new VisualSettings();

  // dados
  private allNodes: Node[] = [];
  private filteredNodes: Node[] = [];

  // estado de UI
  private expandedKeys = new Set<string>();      // nós expandidos
  private selectedNodeKeys = new Set<string>();  // nós selecionados (estado local)
  private currentSelectedKey: string | null = null;

  // busca preservada entre updates locais
  private searchQuery: string = "";

  // anti-loop e detecção de troca de contexto
  private lastAppliedSig: string = "";
  private allowAutoPick: boolean = false;
  private lastDataSig: string = "";

  constructor(options?: VisualConstructorOptions) {
    this.host = options!.host;
    this.selectionManager = this.host.createSelectionManager();
    this.target = options!.element;

    // root
    this.container = document.createElement("div");
    this.container.className = "hf__root";
    this.target.appendChild(this.container);

    // título
    this.titleEl = document.createElement("div");
    this.titleEl.className = "hf__title";
    this.container.appendChild(this.titleEl);

    // busca
    this.searchWrap = document.createElement("div");
    this.searchWrap.className = "hf__search";
    this.container.appendChild(this.searchWrap);

    // árvore
    this.treeWrap = document.createElement("div");
    this.treeWrap.className = "hf__tree";
    this.container.appendChild(this.treeWrap);
  }

  // ===================== UPDATE =====================
  public update(options: VisualUpdateOptions): void {
    const dv = options.dataViews && options.dataViews[0];
    if (!dv) {
      // não emita clear aqui; apenas saia
      return;
    }

    // 1) formatação: só parseia quando há objects (evita reset transitório)
    if (dv.metadata?.objects) {
      this.settings = VisualSettings.parse<VisualSettings>(dv, this.settings);
    }

    // 2) aplica fonte/título
    this.container.style.fontSize = `${this.settings.itemText.fontSize}px`;
    this.titleEl.style.display = this.settings.title.show ? "block" : "none";
    this.titleEl.textContent = this.settings.title.text;
    this.titleEl.style.fontSize = `${this.settings.title.fontSize}px`;

    // 3) reconstrói a árvore com o DataView já filtrado por outros visuais
    this.allNodes = this.buildTree(dv);

    // 4) detecta troca de contexto (ex.: Estado mudou)
    const newSig = this.dataSignature(this.allNodes);
    const dataChanged = newSig !== this.lastDataSig;
    this.lastDataSig = newSig;

    // 5) aplica a busca atual; se zera por causa do novo contexto, limpe a busca
    const q = this.searchQuery.trim().toLowerCase();
    this.filteredNodes = q ? this.filterTree(this.allNodes, q) : this.allNodes;

    if (dataChanged && q && this.filteredNodes.length === 0) {
      // busca antiga não tem resultados no novo contexto → limpar e reiniciar
      this.searchQuery = "";
      this.filteredNodes = this.allNodes;
      this.expandedKeys.clear();
      // NÃO zere selectedNodeKeys aqui; deixe o contexto refletir o host
      this.currentSelectedKey = null;
      // não mexa em lastAppliedSig aqui; não vamos emitir seleção em update
    }

    // 6) desenha a barra de busca (reflete this.searchQuery)
    this.renderSearch();

    // 7) poda estados para chaves que ainda existem
    const presentKeys = new Set<string>();
    this.walkNodes(this.filteredNodes, n => presentKeys.add(n.key));

    for (const k of Array.from(this.expandedKeys)) {
      if (!presentKeys.has(k)) this.expandedKeys.delete(k);
    }
    for (const k of Array.from(this.selectedNodeKeys)) {
      if (!presentKeys.has(k)) this.selectedNodeKeys.delete(k);
    }
    if (this.currentSelectedKey && !presentKeys.has(this.currentSelectedKey)) {
      this.currentSelectedKey = null;
    }

    // 8) garanta raízes abertas ao menos uma vez
    if (this.expandedKeys.size === 0) {
      this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
    }

    // 9) render e sincronização — sem auto-pick e sem emitir seleção em update externo
    this.renderTree();
    this.ensureSingleSelected(false);
    this.applySelection(false);
  }

  // ===================== HELPERS =====================
  private clearElement(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  private walkNodes(list: Node[], fn: (n: Node) => void): void {
    for (const n of list) {
      fn(n);
      if (n.children?.length) this.walkNodes(n.children, fn);
    }
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

  private selectionSignature(keys: Set<string>): string {
    const arr = Array.from(keys).sort();
    return arr.join("|");
  }

  private dataSignature(nodes: Node[]): string {
    const roots = nodes.map(n => `${n.level}:${n.value}`).sort();
    return roots.join("||");
  }

  /**
   * Aplica seleção ao host:
   * - Em update externo (force=false) e seleção local vazia → NÃO limpa o host.
   * - Em ações do usuário (force=true) → "quem clicou manda": replace (merge=false).
   */
  private applySelection(force = false) {
    const ids = this.collectSelectedIds();

    if (!force) {
        // update externo → não emitir/limpar
        return;
    }

    if (ids.length === 0) {
        void this.selectionManager.clear();
    } else {
        void this.selectionManager.select(ids, /* multiSelect */ true);
    }
    }


  private ensureSingleSelected(allowAutoPick: boolean): void {
    if (!this.settings.behavior.singleSelect) return;
    if (this.selectedNodeKeys.size > 0) return;
    if (!allowAutoPick) return;

    const first = this.findFirstSelectable(this.filteredNodes);
    if (first) {
      this.selectedNodeKeys.clear();
      this.selectedNodeKeys.add(first.key);
      this.currentSelectedKey = first.key;

      const el = this.treeWrap.querySelector<HTMLInputElement>(
        `input[data-key="${first.key}"]`
      );
      if (el) el.checked = true;
    }
  }

  // ===================== BUILD TREE (agrupa por caminho) =====================
  private buildTree(dataView: DataView): Node[] {
  const cat = dataView.categorical?.categories;
  if (!cat || cat.length === 0) {
    return [];
  }

  // coluna MAIS PROFUNDA com identity (ex.: Cidade)
  let deepIdx = -1;
  for (let i = cat.length - 1; i >= 0; i--) {
    if (Array.isArray((cat[i] as any).identity) && (cat[i] as any).identity.length > 0) {
      deepIdx = i;
      break;
    }
  }
  const baseCat = deepIdx >= 0 ? cat[deepIdx] : null;

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
        if (!node.selectionIds.some(s => (s as any).equals ? (s as any).equals(selId) : false)) {
          node.selectionIds.push(selId);
        }
      }

      parentPath = path;
    }
  }

  return roots;
}


  // ===================== SEARCH UI =====================
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
    input.value = this.searchQuery; // preserva entre updates

    const applyQuery = () => {
      const qNow = this.searchQuery.trim().toLowerCase();
      this.filteredNodes = qNow ? this.filterTree(this.allNodes, qNow) : this.allNodes;

      if (this.expandedKeys.size === 0) {
        this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
      }

      this.renderTree();

      // ação do usuário: autoritativo + auto-pick em single
      this.allowAutoPick = true;
      this.ensureSingleSelected(true);
      this.applySelection(true);
      this.allowAutoPick = false;
    };

    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      applyQuery();
    });

    // Botão Limpar (em single-select escolhe o primeiro)
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "✕";
    clearBtn.title = "Limpar filtro e seleção";
    clearBtn.style.cursor = "pointer";
    clearBtn.addEventListener("click", () => {
      this.searchQuery = "";
      input.value = "";
      this.filteredNodes = this.allNodes;

      this.expandedKeys.clear();
      this.selectedNodeKeys.clear();
      this.currentSelectedKey = null;

      this.renderTree();

      this.allowAutoPick = true;       // ação do usuário
      this.ensureSingleSelected(true); // single → seleciona o primeiro
      this.applySelection(true);       // autoritativo
      this.allowAutoPick = false;
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

  // ===================== RENDER TREE =====================
  private renderTree(): void {
    this.clearElement(this.treeWrap);

    const renderNode = (node: Node, container: HTMLElement) => {
      const isLeaf = !node.children || node.children.length === 0;
      const isExpanded = this.expandedKeys.has(node.key);

      const row = document.createElement("div");
      row.className = "hf__row";
      row.style.paddingLeft = `${node.level * (this.settings.itemText.indent || 14)}px`;

      // caret (expande/colapsa)
      if (node.children?.length) {
        const caret = document.createElement("span");
        caret.className = "hf__caret";
        caret.textContent = isExpanded ? "▾" : "▸";
        caret.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isExpanded) this.expandedKeys.delete(node.key);
          else this.expandedKeys.add(node.key);
          this.renderTree();
          // nada de seleção aqui
        });
        row.appendChild(caret);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "hf__caret --empty";
        row.appendChild(spacer);
      }

      // input (checkbox ou radio)
      const showInput = this.isSelectable(node);
      const inputType = this.settings.behavior.singleSelect ? "radio" : "checkbox";
      let inputEl: HTMLInputElement | null = null;

      if (showInput) {
        const inp = document.createElement("input");
        inp.type = inputType;
        if (inputType === "radio") inp.name = "hf-single-select-group";
        inp.className = "hf__chk";
        inp.dataset.key = node.key;

        inp.checked = this.selectedNodeKeys.has(node.key);
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

      // clique/seleção
      if (showInput) {
        const toggleAndApply = () => {
          // seleção única: clicar no já selecionado não faz nada
          if (this.settings.behavior.singleSelect && this.selectedNodeKeys.has(node.key)) {
            if (inputEl) inputEl.checked = true;
            return;
          }

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

          // ação do usuário: autoritativa
          this.allowAutoPick = true;
          this.ensureSingleSelected(true);
          this.applySelection(true);
          this.allowAutoPick = false;
        };

        inputEl!.addEventListener("change", toggleAndApply);

        row.addEventListener("click", (e) => {
          const t = (e.target as HTMLElement).tagName.toLowerCase();
          if (t !== "input") {
            // em rádio, clique no já selecionado não altera
            if (inputEl!.type === "radio" && this.selectedNodeKeys.has(node.key)) {
              inputEl!.checked = true;
              return;
            }
            if (inputEl!.type === "radio") {
              inputEl!.checked = true;
            } else {
              inputEl!.checked = !inputEl!.checked;
            }
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

    // garante que raízes apareçam (se ninguém estiver expandido)
    if (this.expandedKeys.size === 0) {
      this.filteredNodes.forEach(r => this.expandedKeys.add(r.key));
    }

    this.filteredNodes.forEach(n => renderNode(n, this.treeWrap));
  }

  // ===================== PAINEL DE FORMATAÇÃO =====================
  public enumerateObjectInstances(
    options: powerbi.EnumerateVisualObjectInstancesOptions
  ): powerbi.VisualObjectInstanceEnumeration {
    const instances: powerbi.VisualObjectInstance[] = [];

    // helper: empurra SEM selector (persistência em nível de visual)
    const push = (o: any) => { instances.push(o as unknown as powerbi.VisualObjectInstance); };

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
