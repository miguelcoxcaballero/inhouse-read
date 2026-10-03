import { describe, expect, it } from 'vitest';
import { driveBookLength, normalizeDriveBookLength, wordCountFromDrive } from '../../src/js/book-length-drive.js';
import { completeWordCount } from '../../src/js/book-length.js';

const checksum='abcdef0123456789abcdef0123456789';
const original=()=>({driveFileId:'drive-book',driveContentChecksum:checksum,contentDriveChecksum:checksum,
  size:100,content:{size:100},contentRevision:'local-v1',wordCountContentRevision:'local-v1',...completeWordCount(120_000)});

describe('Drive word-count metadata',()=>{
  it('round trips the complete count without page estimates, title/style changes or original-file mutation',()=>{
    const book=original(),metadata=driveBookLength(book);
    expect(normalizeDriveBookLength(JSON.parse(JSON.stringify(metadata)))).toEqual(metadata);
    const fresh={...book,wordCount:null,wordCountComplete:false,contentRevision:'second-device'};
    expect(wordCountFromDrive(fresh,metadata)).toEqual({...completeWordCount(120_000),wordCountContentRevision:'second-device',lengthDirty:false});
  });
  it('does not let remote text override a completed count of the local original',()=>{
    expect(wordCountFromDrive(original(),{...driveBookLength(original()),wordCount:90_000})).toBeNull();
  });
  it('rejects counts for another Drive original, checksum, byte length or incomplete extraction',()=>{
    const fresh={...original(),wordCountComplete:false},metadata=driveBookLength(original());
    for(const change of [{driveFileId:'another'},{md5Checksum:'1'.repeat(32)},{byteLength:101},
      {wordCountComplete:false},{wordCountVersion:1},{wordCount:-1},{wordCount:Infinity}])
      expect(wordCountFromDrive(fresh,{...metadata,...change})).toBeNull();
  });
  it('preserves unverified historical counts in state JSON without trusting them as another device geometry',()=>{
    const historical={...original(),driveContentChecksum:null,contentDriveChecksum:null};
    const metadata=driveBookLength(historical);expect(metadata.wordCount).toBe(120_000);
    expect(metadata.md5Checksum).toBeNull();expect(normalizeDriveBookLength(metadata)).toEqual(metadata);
    expect(wordCountFromDrive({...historical,wordCountComplete:false},metadata)).toBeNull();
  });
  it('does not associate cached bytes of a different known Drive revision with its new remote checksum',()=>{
    const old={...original(),contentDriveChecksum:'f'.repeat(32)};
    expect(driveBookLength(old)).toBeNull();
    expect(wordCountFromDrive({...old,wordCountComplete:false},driveBookLength(original()))).toBeNull();
  });
  it('does not certify locally reimported bytes against the previously saved Drive checksum',()=>{
    const reimported={...original(),contentDriveChecksum:null};
    const metadata=driveBookLength(reimported);
    expect(metadata.wordCount).toBe(120_000);expect(metadata.md5Checksum).toBeNull();
    expect(wordCountFromDrive({...original(),wordCountComplete:false},metadata)).toBeNull();
  });
});
