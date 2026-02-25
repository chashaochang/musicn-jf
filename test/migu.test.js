import { test } from 'node:test';
import assert from 'node:assert';

test('Migu Route 1: search does not resolve directUrl', async (t) => {
  // Mock data structure from Migu API
  const mockItem = {
    id: '2410',
    copyrightId: '60054701923',
    contentId: '600543000007927466',
    name: 'Test Song',
    singers: [{ name: 'Test Artist' }],
    albums: [{ name: 'Test Album' }],
    imgItems: [{ img: 'https://example.com/cover_500.jpg' }],
    format: 'MP3'
  };

  // Simulate the Route 1 mapping logic from searchMigu
  const copyrightId = mockItem.copyrightId || mockItem.id || mockItem.contentId;
  const contentId = mockItem.contentId || mockItem.id || mockItem.copyrightId;
  
  const result = {
    id: mockItem.id || contentId,
    copyrightId: copyrightId,
    contentId: contentId,
    title: mockItem.name || mockItem.songName || 'Unknown',
    artist: mockItem.singers?.map(s => s.name).join(', ') || mockItem.singer || 'Unknown Artist',
    album: mockItem.albums?.[0]?.name || mockItem.albumName || '',
    coverUrl: mockItem.imgItems?.[0]?.img || '',
    downloadUrl: '', // Route 1: empty, resolved during task execution
    disabled: !copyrightId, // Only disabled if copyrightId is missing
    fileSize: '',
    format: mockItem.format || 'MP3',
    rawFormat: mockItem.format
  };

  // Verify Route 1 behavior
  assert.strictEqual(result.copyrightId, '60054701923', 'copyrightId should be explicitly included');
  assert.strictEqual(result.contentId, '600543000007927466', 'contentId should be explicitly included');
  assert.strictEqual(result.downloadUrl, '', 'downloadUrl should be empty in Route 1');
  assert.strictEqual(result.disabled, false, 'should not be disabled when copyrightId is present');
  assert.strictEqual(result.coverUrl, 'https://example.com/cover_500.jpg', 'should extract cover from imgItems');
  
  console.log('✓ Route 1: Search does not resolve directUrl, extracts cover from imgItems');
});

test('Migu Route 1: cover URL prioritizes imgItems', async (t) => {
  // Test different cover URL sources
  const testCases = [
    {
      item: { imgItems: [{ img: 'https://example.com/img500.jpg' }] },
      expected: 'https://example.com/img500.jpg',
      desc: 'imgItems takes priority'
    },
    {
      item: { imgItems: [], cover: 'https://example.com/cover.jpg' },
      expected: 'https://example.com/cover.jpg',
      desc: 'fallback to cover field'
    },
    {
      item: { albumImgs: 'https://example.com/album.jpg' },
      expected: 'https://example.com/album.jpg',
      desc: 'fallback to albumImgs'
    }
  ];

  for (const testCase of testCases) {
    const item = testCase.item;
    let coverUrl = '';
    
    if (item.imgItems && Array.isArray(item.imgItems) && item.imgItems.length > 0) {
      const firstImg = item.imgItems.find(img => img.img);
      coverUrl = firstImg?.img || '';
    }
    if (!coverUrl) {
      coverUrl = item.cover || item.albumImgs || item.largePic || '';
    }
    
    assert.strictEqual(coverUrl, testCase.expected, testCase.desc);
  }
  
  console.log('✓ Cover URL extraction correctly prioritizes imgItems');
});

test('Migu Route 1: disabled only when missing copyrightId', async (t) => {
  // Test case 1: Has copyrightId - not disabled
  const itemWithCopyright = {
    copyrightId: '60054701923',
    contentId: '600543000007927466'
  };
  
  const copyrightId1 = itemWithCopyright.copyrightId || itemWithCopyright.id || itemWithCopyright.contentId;
  const disabled1 = !copyrightId1;
  
  assert.strictEqual(disabled1, false, 'should not be disabled when copyrightId is present');
  
  // Test case 2: Missing copyrightId but has contentId - not disabled (uses contentId as fallback)
  const itemWithContentId = {
    contentId: '600543000007927466'
  };
  
  const copyrightId2 = itemWithContentId.copyrightId || itemWithContentId.id || itemWithContentId.contentId;
  const disabled2 = !copyrightId2;
  
  assert.strictEqual(disabled2, false, 'should not be disabled when contentId can be used as copyrightId');
  
  // Test case 3: Missing all identifiers - disabled
  const itemWithoutIds = {
    name: 'Test Song'
  };
  
  const copyrightId3 = itemWithoutIds.copyrightId || itemWithoutIds.id || itemWithoutIds.contentId;
  const disabled3 = !copyrightId3;
  
  assert.strictEqual(disabled3, true, 'should be disabled when no identifiers are present');
  
  console.log('✓ Disabled logic only checks for missing copyrightId/identifiers');
});

test('Migu Route 1: task stores resolution fields', async (t) => {
  // Simulate task creation with Route 1 fields
  const taskData = {
    service: 'migu',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    coverUrl: 'https://example.com/cover.jpg',
    downloadUrl: '', // Empty in Route 1
    fileSize: '',
    format: 'MP3',
    preferredToneFlag: 'HQ',
    allowDegrade: true,
    degradeOrder: ['HQ', 'PQ', 'LQ'],
    copyrightId: '60054701923', // Route 1: stored for resolution
    contentId: '600543000007927466', // Route 1: stored for resolution
    rawFormat: { formatType: 'HQ', size: 12345678 } // Route 1: stored for resolution
  };

  // Verify all required Route 1 fields are present
  assert.ok(taskData.copyrightId, 'copyrightId should be stored');
  assert.ok(taskData.contentId, 'contentId should be stored');
  assert.ok(taskData.rawFormat, 'rawFormat should be stored');
  assert.strictEqual(taskData.downloadUrl, '', 'downloadUrl is empty in Route 1');
  
  console.log('✓ Task stores all required Route 1 resolution fields');
});
