import { exportToMarkdown } from '../export';
import {
  LibraryCiteKeys,
  findDuplicateCiteKeys,
  importAllItems,
} from '../importAll';

jest.mock('obsidian', () => ({}), { virtual: true });
jest.mock('../export', () => ({ exportToMarkdown: jest.fn() }));
jest.mock('../jsonRPC', () => ({
  getCiteKeyExport: jest.fn(),
  getUserGroups: jest.fn(),
}));
jest.mock('../cayw', () => ({ isZoteroRunning: jest.fn() }));
jest.mock('../LoadingModal', () => ({
  LoadingModal: { suppress: jest.fn(), unsuppress: jest.fn() },
}));

const exportMock = exportToMarkdown as jest.Mock;
const params = {} as any;

function lib(libraryID: number, name: string, keys: string[]): LibraryCiteKeys {
  return {
    libraryID,
    name,
    citeKeys: keys.map((key) => ({ key, library: libraryID })),
  };
}

/** Every call writes one note per citekey, except for keys listed in `bad`. */
function exportWritesAllExcept(bad: string[] = []) {
  exportMock.mockImplementation(async (_p: any, batch: { key: string }[]) => {
    if (batch.some((ck) => bad.includes(ck.key))) throw new Error('bad item');
    return batch.map((ck) => `${ck.key}.md`);
  });
}

beforeEach(() => exportMock.mockReset());

describe('findDuplicateCiteKeys', () => {
  it('reports citekeys present in more than one library', () => {
    expect(
      findDuplicateCiteKeys([lib(1, 'Mine', ['a', 'b']), lib(2, 'G', ['b', 'c'])])
    ).toEqual(['b']);
  });
});

describe('importAllItems', () => {
  it('imports one probe item, then full batches that never mix libraries', async () => {
    exportWritesAllExcept();
    const res = await importAllItems(
      params,
      [lib(1, 'Mine', ['a', 'b', 'c', 'd']), lib(2, 'G', ['e', 'f'])],
      { batchSize: 2 }
    );

    const batches = exportMock.mock.calls.map((c) =>
      c[1].map((ck: any) => `${ck.library}:${ck.key}`)
    );
    expect(batches).toEqual([
      ['1:a'],
      ['1:b', '1:c'],
      ['1:d'],
      ['2:e', '2:f'],
    ]);
    expect(res).toMatchObject({
      requested: 6,
      written: 6,
      failed: [],
      cancelled: false,
      aborted: false,
    });
  });

  it('retries a failed batch item by item', async () => {
    exportWritesAllExcept(['c']);
    const res = await importAllItems(params, [lib(1, 'Mine', ['a', 'b', 'c', 'd'])], {
      batchSize: 3,
    });
    expect(res.written).toBe(3);
    expect(res.failed).toEqual(['c']);
  });

  it('aborts when the first items all fail', async () => {
    exportMock.mockRejectedValue(new Error('template error'));
    const res = await importAllItems(params, [
      lib(1, 'Mine', ['a', 'b', 'c', 'd', 'e', 'f']),
    ]);
    expect(res.aborted).toBe(true);
    expect(exportMock).toHaveBeenCalledTimes(3);
  });

  it('stops between batches when cancelled', async () => {
    exportWritesAllExcept();
    let calls = 0;
    const res = await importAllItems(params, [lib(1, 'Mine', ['a', 'b', 'c'])], {
      batchSize: 1,
      isCancelled: () => calls++ >= 1,
    });
    expect(res.cancelled).toBe(true);
    expect(res.written).toBe(1);
  });
});
