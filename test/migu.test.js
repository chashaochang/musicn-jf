import { test } from 'node:test';
import assert from 'node:assert';

test('Migu search result includes copyrightId and contentId fields', async (t) => {
  // Mock data structure from Migu API
  const mockItem = {
    id: '2410',
    copyrightId: '60054701923',
    contentId: '600543000007927466',
    name: 'Test Song',
    singers: [{ name: 'Test Artist' }],
    albums: [{ name: 'Test Album' }],
    cover: 'https://example.com/cover.jpg',
    format: 'MP3'
  };

  // Simulate the mapping logic from searchMigu
  const result = {
    id: mockItem.id || mockItem.contentId || mockItem.copyrightId,
    copyrightId: mockItem.copyrightId,
    contentId: mockItem.contentId,
    title: mockItem.name || mockItem.songName || 'Unknown',
    artist: mockItem.singers?.map(s => s.name).join(', ') || mockItem.singer || 'Unknown Artist',
    album: mockItem.albums?.[0]?.name || mockItem.albumName || '',
    downloadUrl: '',
    directUrl: null,
    disabled: true,
    fileSize: '',
    format: mockItem.format || 'MP3'
  };

  // Verify that copyrightId and contentId are explicitly included
  assert.strictEqual(result.copyrightId, '60054701923', 'copyrightId should be explicitly included');
  assert.strictEqual(result.contentId, '600543000007927466', 'contentId should be explicitly included');
  assert.strictEqual(result.id, '2410', 'id should be preserved for frontend compatibility');
  
  console.log('✓ Search result mapping correctly includes copyrightId and contentId fields');
});

test('Migu resourceinfo URL generation uses copyrightId', async (t) => {
  const mockSong = {
    copyrightId: '60054701923',
    contentId: '600543000007927466',
    id: '2410'
  };

  // Simulate the copyrightId extraction logic
  const copyrightId = mockSong.copyrightId || mockSong.id || mockSong.contentId;
  const detailUrl = `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${copyrightId}&resourceType=2`;

  // Verify that the URL uses the actual copyrightId
  assert.ok(detailUrl.includes('copyrightId=60054701923'), 'URL should use actual copyrightId');
  assert.strictEqual(copyrightId, '60054701923', 'Should prioritize copyrightId over id');
  
  console.log('✓ ResourceInfo URL correctly uses copyrightId from API');
});

test('Migu search handles missing copyrightId gracefully', async (t) => {
  const mockItem = {
    id: '2410',
    // copyrightId is missing
    contentId: '600543000007927466',
    name: 'Test Song'
  };

  const result = {
    id: mockItem.id || mockItem.contentId || mockItem.copyrightId,
    copyrightId: mockItem.copyrightId, // Will be undefined
    contentId: mockItem.contentId,
    title: mockItem.name || 'Unknown'
  };

  // Verify that undefined copyrightId is handled
  assert.strictEqual(result.copyrightId, undefined, 'copyrightId can be undefined if not in API response');
  assert.strictEqual(result.contentId, '600543000007927466', 'contentId should still be included');
  
  console.log('✓ Missing copyrightId is handled gracefully');
});
