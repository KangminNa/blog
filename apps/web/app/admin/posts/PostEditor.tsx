'use client';

import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { postPath } from '../../_blog/format';
import { POST_STATUS_LABELS } from '../../_blog/labels';
import type { Asset, EditablePost, PostStatus, SavedPost } from '../../_blog/types';
import { type ApiReply, api, describe, uploadFile } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useToast } from '../../_ui/useToast';
import { BigQuote } from './editor/big-quote';
import { docToMarkdown, markdownToEditorHtml } from './editor/markdown-doc';
import { WikiPicker } from './WikiPicker';

/** 편집기가 다루는 글: 불러온 글이거나 방금 쓴 결과 (둘 다 편집기가 쓰는 칸을 모두 가진다) */
export type LinkedPost = EditablePost | SavedPost;

/** 글 설정 (발행 창에서 고르는 것) */
type Settings = {
  tags: string;
  slug: string;
  align: 'left' | 'center';
  mainWikiId: string | null;
  refWikiIds: readonly string[];
};

/** 서버의 이미지 본문 한도와 같다 (HttpSetup.IMAGE_LIMIT) */
const PHOTO_MAX = 10 * 1024 * 1024;
const PHOTO_TOO_BIG = '10MB 이하 사진만 올릴 수 있어요';
const PHOTO_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

/** 서버의 Post.REFS_MAX와 같다 */
const REFS_MAX = 20;

const STATUSES: readonly [PostStatus, string][] = [
  ['published', '목록에 표시'],
  ['unlisted', '주소를 아는 사람만'],
  ['draft', '나만'],
];

const STATUS_DONE: Record<PostStatus, string> = {
  draft: '초안으로 돌렸어요',
  published: '글을 공개했어요',
  unlisted: '링크 공개로 바꿨어요',
};

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    underline: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center'] }),
  Placeholder.configure({ placeholder: '내용을 입력하세요' }),
  // 문단 안의 사진: 가운데 정렬이 그대로 먹고, md의 ![…](…) 한 줄이 문단으로 돌아온다
  Image.configure({ inline: true }),
  BigQuote,
];

function settingsOf(post: LinkedPost | null): Settings {
  return post
    ? {
        tags: post.tags.join(', '),
        slug: post.slug,
        align: post.align,
        mainWikiId: post.mainWikiId,
        refWikiIds: post.refWikiIds,
      }
    : { tags: '', slug: '', align: 'left', mainWikiId: null, refWikiIds: [] };
}

/** 고른 순서는 뜻이 없어서 순서 없이 견준다 */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join('\n') === [...b].sort().join('\n');
}

function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().replace(/^#+/, '').trim())
    .filter((t) => t.length > 0);
}

/** 도구 막대가 보여줄 지금 상태 (커서가 있는 곳의 모양) */
function toolState({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return {
    h2: editor.isActive('heading', { level: 2 }),
    h3: editor.isActive('heading', { level: 3 }),
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    center: editor.isActive({ textAlign: 'center' }),
    quote: editor.isActive('blockquote'),
    bigQuote: editor.isActive('bigQuote'),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    link: editor.isActive('link'),
    code: editor.isActive('codeBlock'),
    undo: editor.can().undo(),
    redo: editor.can().redo(),
  };
}

// 글 편집기: 쓰는 화면이 곧 보이는 화면 (Tiptap). 방문자가 볼 모양 그대로 쓴다.
// 저장은 md 그대로 (editor/markdown-doc.ts). 제목·본문이 바뀌었으면 새 판이 쌓인다.
// 공개 범위·태그·주소·위키·전체 가운데 정렬은 "발행" 창에서 고른다. 주소는 비우면 제목에서 만든다.
// 위키는 바뀐 칸만 보낸다: 그사이 지워진 wiki가 이어져 있어도 나머지를 고쳐 저장할 수 있게.
// 다른 탭에서 먼저 고쳤으면 서버가 409로 막고, 덮어쓰지 않고 다시 불러오라고 알린다.
export function PostEditor({ initial }: { initial: LinkedPost | null }) {
  const [post, setPost] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [settings, setSettings] = useState(() => settingsOf(initial));
  const [body, setBody] = useState(initial?.body ?? '');
  /** 불러온(또는 마지막으로 저장한) 본문을 편집기가 md로 다시 쓴 것. 바뀐 것이 있는지 이것과 견준다 */
  const [baseline, setBaseline] = useState(initial?.body ?? '');
  const action = useAction();
  /** 보내기 전에 아는 오류(제목 없음 · 사진 크기)와 사진 올리기의 오류. 동작의 오류와 한 자리에 보인다 */
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [panel, setPanel] = useState(false);
  const [choice, setChoice] = useState<PostStatus>('published');
  const [uploading, setUploading] = useState(false);
  const [toast, showToast] = useToast();
  const photoInput = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();

  const editor = useEditor({
    extensions: EXTENSIONS,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'editor-prose', 'aria-label': '본문' } },
    onCreate: ({ editor: e }) => {
      if (initial?.body)
        e.commands.setContent(markdownToEditorHtml(initial.body), { emitUpdate: false });
      const md = docToMarkdown(e.getJSON());
      setBody(md);
      setBaseline(md);
    },
    onUpdate: ({ editor: e }) => setBody(docToMarkdown(e.getJSON())),
  });
  const tools = useEditorState({ editor, selector: toolState });

  const slugChanged =
    post !== null && settings.slug.trim() !== '' && settings.slug.trim() !== post.slug;
  const mainChanged = settings.mainWikiId !== (post?.mainWikiId ?? null);
  const refsChanged = !sameIds(settings.refWikiIds, post?.refWikiIds ?? []);
  const mainPicks = useMemo(
    () => (settings.mainWikiId ? [settings.mainWikiId] : []),
    [settings.mainWikiId],
  );
  const refExclude = useMemo(() => [settings.mainWikiId], [settings.mainWikiId]);
  const dirty =
    mainChanged ||
    refsChanged ||
    (post
      ? title.trim() !== post.title ||
        body !== baseline ||
        tagsOf(settings.tags).join('\n') !== post.tags.join('\n') ||
        settings.align !== post.align ||
        slugChanged
      : title.trim() !== '' || body !== '');

  const busy = action.busy === 'save' || action.busy === 'status';
  const problem = error ?? action.problem;

  // 새 동작은 앞의 오류를 지우고 시작한다. 409면 쓰던 내용을 지키려고 다시 읽지 않고 "다시 불러오기"를 보여 준다
  async function send<T>(name: string, call: () => Promise<ApiReply<T>>) {
    setError(null);
    const reply = await action.run(name, call);
    if (reply && !reply.ok) setConflict(reply.status === 409);
    return reply;
  }

  async function save(): Promise<LinkedPost | null> {
    if (!title.trim()) {
      setError('제목을 적어 주세요');
      return null;
    }
    const fields = {
      title,
      // 본문을 손대지 않았으면 저장된 md 그대로: 편집기가 다시 쓴 모양만 달라 새 판이 쌓이지 않게
      body: post && body === baseline ? post.body : body,
      tags: tagsOf(settings.tags),
      align: settings.align,
      ...(mainChanged ? { mainWikiId: settings.mainWikiId } : {}),
      ...(refsChanged ? { refWikiIds: settings.refWikiIds } : {}),
    };
    const reply = await send('save', () =>
      post
        ? api<SavedPost>('PUT', `/api/posts/${post.id}`, {
            ...fields,
            version: post.version,
            slug: slugChanged ? settings.slug.trim() : null,
          })
        : api<SavedPost>('POST', '/api/posts', {
            ...fields,
            requestId: requestId.current,
            slug: settings.slug.trim() || null,
          }),
    );
    if (!reply?.ok) return null;
    const saved = reply.data;
    if (!post) window.history.replaceState(null, '', `/admin/posts/${saved.id}`);
    setPost(saved);
    setBaseline(body);
    setSettings((s) => ({
      ...s,
      slug: saved.slug,
      mainWikiId: saved.mainWikiId,
      refWikiIds: saved.refWikiIds,
    }));
    if (saved.revised) showToast(`저장했어요 · ${saved.revisionCount}판`);
    else showToast(saved.version === post?.version ? '바뀐 내용이 없어요' : '저장했어요');
    return saved;
  }

  /** 발행 창의 "적용": 저장한 뒤 공개 범위가 다르면 바꾼다 */
  async function apply() {
    const current = !post || dirty ? await save() : post;
    if (!current) return;
    if (current.status !== choice) {
      const reply = await send('status', () =>
        api<SavedPost>('POST', `/api/posts/${current.id}/status`, {
          version: current.version,
          status: choice,
        }),
      );
      if (!reply?.ok) return;
      setPost(reply.data);
      showToast(STATUS_DONE[choice]);
    }
    setPanel(false);
  }

  function openPanel() {
    setChoice(!post || post.status === 'draft' ? 'published' : post.status);
    setPanel(!panel);
  }

  async function trash() {
    if (!post) return;
    if (!window.confirm('휴지통으로 옮길까요? 30일 동안 되살릴 수 있어요')) return;
    const drop = () => api('DELETE', `/api/posts/${post.id}`, { version: post.version });
    const reply = await send('trash', drop);
    if (reply?.ok) window.location.href = '/admin/posts';
  }

  async function recover() {
    if (!post) return;
    const reply = await send('restore', () =>
      api<SavedPost>('POST', `/api/posts/${post.id}/restore`, { version: post.version }),
    );
    if (!reply?.ok) return;
    setPost(reply.data);
    showToast('되살렸어요');
  }

  /** 사진은 글에 붙으므로 새 글이면 먼저 저장한다. 본문에는 커서 자리에 넣고, 저장은 평소처럼 */
  async function addPhoto(file: File) {
    if (file.size > PHOTO_MAX) return setError(PHOTO_TOO_BIG);
    const target = post ?? (await save());
    if (!target) return;
    setUploading(true);
    setError(null);
    action.clear();
    const reply = await uploadFile<Asset>(`/api/posts/${target.id}/assets`, file);
    setUploading(false);
    if (!reply.ok) return setError(reply.status === 413 ? PHOTO_TOO_BIG : describe(reply.error));
    const alt = file.name.replace(/\.[^.]+$/, '');
    editor?.chain().focus().setImage({ src: reply.data.url, alt }).run();
    showToast('사진을 넣었어요');
  }

  function addLink() {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = window.prompt('링크 주소', 'https://');
    if (!href || href === 'https://') return;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  // 발행 창은 길어서 스크롤되므로 오류가 보이는 곳까지 옮긴다
  useEffect(() => {
    if (problem) noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [problem]);

  // ⌘S · Ctrl+S로 저장, 저장 안 한 채 떠나려 하면 묻는다. save가 그릴 때마다 새것이라 그때마다 다시 건다
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) void save();
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', leave);
    };
  });

  const trashed = post?.deletedAt != null;
  const status = post?.status ?? 'draft';
  const state = !post
    ? '새 글 · 아직 저장 안 함'
    : dirty
      ? '저장 안 한 변경 있음'
      : `저장됨 · ${post.revisionCount}판`;

  /** 도구 막대 단추 하나. 누르는 동안 본문의 고른 곳이 풀리지 않게 mousedown을 막는다 */
  const tool = (label: string, title: string, on: boolean | undefined, run: () => void) => (
    <button
      type="button"
      title={title}
      aria-pressed={on ?? false}
      disabled={!editor || trashed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  );
  const chain = () => editor?.chain().focus();
  /** 저장 오류. 발행 창이 열려 있으면 창이 본문 위의 알림을 가리므로 창 안에 보여 준다 */
  const notice = (place: string) =>
    problem && (
      <p ref={noticeRef} className={place} role="alert">
        {problem}
        {conflict && (
          <button type="button" className="ghost" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        )}
      </p>
    );

  return (
    <div className="editor">
      <header className="editor-top">
        <a className="ghost" href="/admin/posts">
          ← 글 목록
        </a>
        <span className="editor-state" aria-live="polite">
          {state}
          {post ? ` · ${POST_STATUS_LABELS[status]}` : ''}
        </span>
        <div className="editor-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy || trashed}
            onClick={() => void save()}
          >
            {busy ? '저장 중' : '저장'}
          </button>
          <button
            type="button"
            className="cta small"
            disabled={busy || trashed}
            aria-expanded={panel}
            onClick={openPanel}
          >
            {status === 'draft' ? '발행' : '공개 설정'}
          </button>
        </div>
      </header>

      {panel && (
        <section className="publish" aria-label="발행 설정">
          <fieldset className="publish-status">
            <legend>공개 범위</legend>
            {STATUSES.map(([s, help]) => (
              <button
                key={s}
                type="button"
                aria-pressed={choice === s}
                onClick={() => setChoice(s)}
              >
                <b>{POST_STATUS_LABELS[s]}</b>
                <small>{help}</small>
              </button>
            ))}
          </fieldset>
          <label className="field">
            <span>태그</span>
            <input
              className="input"
              value={settings.tags}
              placeholder="쉼표로 나눠요 (예: 여행, 제주)"
              onChange={(e) => {
                const tags = e.target.value;
                setSettings((s) => ({ ...s, tags }));
              }}
            />
          </label>
          <label className="field">
            <span>주소</span>
            <input
              className="input"
              value={settings.slug}
              maxLength={80}
              placeholder="비우면 제목에서 만들어요"
              onChange={(e) => {
                const slug = e.target.value;
                setSettings((s) => ({ ...s, slug }));
              }}
            />
            <small>
              /posts/{settings.slug.trim() || '제목에서-자동'}
              {slugChanged && post?.status !== 'draft'
                ? ' · 공개한 글의 주소를 바꾸면 예전 주소로는 못 찾아요'
                : ''}
            </small>
          </label>
          <WikiPicker
            label="대표 위키"
            picks={mainPicks}
            max={1}
            onChange={([main = null]) =>
              setSettings((s) => ({
                ...s,
                mainWikiId: main,
                refWikiIds: s.refWikiIds.filter((id) => id !== main),
              }))
            }
          />
          <WikiPicker
            label="참고 위키"
            picks={settings.refWikiIds}
            max={REFS_MAX}
            exclude={refExclude}
            onChange={(refWikiIds) => setSettings((s) => ({ ...s, refWikiIds }))}
          />
          <div className="plugin-head">
            <span>글 전체 가운데 정렬</span>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={settings.align === 'center'}
              aria-label="글 전체 가운데 정렬"
              onClick={() =>
                setSettings((s) => ({ ...s, align: s.align === 'center' ? 'left' : 'center' }))
              }
            />
          </div>
          {notice('error')}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="ghost" onClick={() => setPanel(false)}>
              닫기
            </button>
            <button
              type="button"
              className="cta small"
              disabled={busy}
              onClick={() => void apply()}
            >
              적용
            </button>
          </div>
        </section>
      )}

      {!panel && notice('error editor-note')}
      {trashed && (
        <p className="warn editor-note">
          휴지통에 있는 글이에요. 되살린 뒤 고칠 수 있어요
          <button type="button" className="ghost" onClick={recover}>
            되살리기
          </button>
        </p>
      )}

      <div className="editor-toolbar" role="toolbar" aria-label="본문 도구">
        {tool('제목', '큰 제목', tools?.h2, () => chain()?.toggleHeading({ level: 2 }).run())}
        {tool('소제목', '작은 제목', tools?.h3, () => chain()?.toggleHeading({ level: 3 }).run())}
        <span className="tool-gap" />
        {tool('굵게', '굵게 (⌘B)', tools?.bold, () => chain()?.toggleBold().run())}
        {tool('기울임', '기울임 (⌘I)', tools?.italic, () => chain()?.toggleItalic().run())}
        {tool('취소선', '취소선', tools?.strike, () => chain()?.toggleStrike().run())}
        {tool('링크', '링크 넣기·빼기', tools?.link, addLink)}
        <button
          type="button"
          title="사진 넣기 (PNG · JPEG · WebP · GIF, 10MB 이하)"
          disabled={!editor || trashed || uploading}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => photoInput.current?.click()}
        >
          {uploading ? '올리는 중' : '사진'}
        </button>
        <input
          ref={photoInput}
          type="file"
          className="sr"
          accept={PHOTO_TYPES}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addPhoto(file);
          }}
        />
        <span className="tool-gap" />
        {tool('가운데', '이 문단 가운데 정렬', tools?.center, () =>
          tools?.center ? chain()?.unsetTextAlign().run() : chain()?.setTextAlign('center').run(),
        )}
        {tool('인용', '인용', tools?.quote, () => chain()?.toggleBlockquote().run())}
        {tool('큰 인용', '가운데 큰 인용', tools?.bigQuote, () => chain()?.toggleBigQuote().run())}
        {tool('목록', '점 목록', tools?.bullet, () => chain()?.toggleBulletList().run())}
        {tool('번호', '번호 목록', tools?.ordered, () => chain()?.toggleOrderedList().run())}
        {tool('구분선', '구분선', false, () => chain()?.setHorizontalRule().run())}
        {tool('코드', '코드 블록', tools?.code, () => chain()?.toggleCodeBlock().run())}
        <span className="tool-gap" />
        <button
          type="button"
          title="되돌리기 (⌘Z)"
          disabled={!tools?.undo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => chain()?.undo().run()}
        >
          ↶
        </button>
        <button
          type="button"
          title="다시 하기 (⇧⌘Z)"
          disabled={!tools?.redo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => chain()?.redo().run()}
        >
          ↷
        </button>
      </div>

      <article className="editor-paper">
        <input
          className="paper-title"
          value={title}
          maxLength={200}
          placeholder="제목"
          aria-label="제목"
          disabled={trashed}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              editor?.commands.focus('start');
            }
          }}
        />
        <div className={`prose${settings.align === 'center' ? ' center' : ''}`}>
          <EditorContent editor={editor} />
        </div>
      </article>

      <footer className="editor-foot">
        {post && post.status !== 'draft' && !trashed ? (
          <a className="ghost" href={postPath(post.slug)} target="_blank" rel="noopener">
            글 보기 ↗
          </a>
        ) : (
          <span />
        )}
        {post && !post.deletedAt && (
          <button type="button" className="ghost danger" onClick={trash}>
            휴지통으로
          </button>
        )}
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
