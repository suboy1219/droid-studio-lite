import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';
import type { EditorTab } from '../types';

interface Props {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onChange: (id: string, content: string) => void;
  onSave: () => void;
}

function languageFor(fileName: string): Extension {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'html':
    case 'htm':
      return html();
    case 'java':
    case 'kt':
    case 'gradle':
      return java();
    default:
      return [];
  }
}

function CodeEditor({
  tab,
  onChange,
  onSave
}: {
  tab: EditorTab;
  onChange: (id: string, content: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const changeRef = useRef(onChange);
  const saveRef = useRef(onSave);
  changeRef.current = onChange;
  saveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: tab.content,
        extensions: [
          basicSetup,
          oneDark,
          languageFor(tab.name),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                saveRef.current();
                return true;
              }
            }
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              changeRef.current(tab.id, update.state.doc.toString());
            }
          })
        ]
      })
    });
    return () => view.destroy();
    // 仅在切换文件时重建编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  return <div className="editor-host" ref={hostRef} />;
}

export default function EditorPane({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onChange,
  onSave
}: Props) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="editor">
      <div className="tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSelect(tab.id)}
            title={tab.path}
          >
            <span className={`tab-kind ${tab.kind}`}>{tab.kind === 'remote' ? 'DEV' : 'LOCAL'}</span>
            <span className="tab-name">
              {tab.name}
              {tab.dirty && <span className="dirty-dot">●</span>}
            </span>
            <button
              className="tab-close"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {!tabs.length && <div className="tabbar-placeholder">没有打开的文件</div>}
      </div>

      <div className="editor-body">
        {activeTab ? (
          <CodeEditor key={activeTab.id} tab={activeTab} onChange={onChange} onSave={onSave} />
        ) : (
          <div className="editor-empty">
            <div className="editor-empty-title">Droid Studio Lite</div>
            <ul>
              <li>在左侧 Device Explorer 双击文件即可编辑设备上的文本文件</li>
              <li>点击工具栏「打开文件」编辑本地文件</li>
              <li>Ctrl+S 保存，Ctrl+Shift+S 另存为，Ctrl+W 关闭标签</li>
            </ul>
          </div>
        )}
      </div>

      {activeTab && (
        <div className="editor-foot">
          <span>{activeTab.kind === 'remote' ? `设备 · ${activeTab.serial}` : '本地'}</span>
          <span className="muted">{activeTab.path}</span>
          <span className="statusbar-spacer" />
          <span>{activeTab.dirty ? '未保存' : '已保存'}</span>
        </div>
      )}
    </div>
  );
}
