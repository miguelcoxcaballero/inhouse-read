import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {rustShelf as native} from './helpers/rust-shelf-ready.js';
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
function fixture(overrides={}){
 const state={driveProfile:{id:'one'},backupTimer:null,roomCaptureTimer:null,roomCaptureBusy:false,roomCaptureAgain:false,roomCaptureFailures:0};
 const host={state,hasDriveSession:vi.fn(()=>true),getRememberedDriveProfile:vi.fn(()=>null),syncLibraryToDrive:vi.fn(async()=>{}),backupFailure:vi.fn(),captureRoom:vi.fn(async()=>{}),drainLive:vi.fn(async()=>{}),markBookChanged:vi.fn(()=>true),warnRoom:vi.fn(),...overrides};
 host.backupCallback=()=>native.app_backup_run(host);host.captureCallback=()=>native.app_room_capture_run(host);return{host,state};
}
it('debounces backups and retains the silent request and reported failure',async()=>{
 const{host,state}=fixture();native.app_backup_schedule(host);await vi.advanceTimersByTimeAsync(200);native.app_backup_schedule(host);await vi.advanceTimersByTimeAsync(349);expect(host.syncLibraryToDrive).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(state.backupTimer).toBeNull();expect(host.syncLibraryToDrive).toHaveBeenCalledExactlyOnceWith({silent:true});
 const error=Error('offline');host.syncLibraryToDrive.mockRejectedValueOnce(error);native.app_backup_schedule(host);await vi.advanceTimersByTimeAsync(350);expect(host.backupFailure).toHaveBeenCalledWith(error);
});
it('cancels a queued backup without an account and accepts a remembered session',async()=>{
 const{host}=fixture();native.app_backup_schedule(host);host.hasDriveSession.mockReturnValue(false);native.app_backup_schedule(host);await vi.advanceTimersByTimeAsync(1000);expect(host.syncLibraryToDrive).not.toHaveBeenCalled();host.getRememberedDriveProfile.mockReturnValue({id:'one'});native.app_backup_schedule(host);await vi.advanceTimersByTimeAsync(350);expect(host.syncLibraryToDrive).toHaveBeenCalledOnce();
});
it('coalesces pending room writes, captures before draining and clears ownership',async()=>{
 const order=[],{host,state}=fixture({captureRoom:vi.fn(async account=>order.push(['capture',account])),drainLive:vi.fn(async account=>order.push(['drain',account]))});
 for(let i=0;i<20;i++)native.app_room_capture_schedule(host,32);
 expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(31);expect(order).toEqual([]);await vi.advanceTimersByTimeAsync(1);expect(order).toEqual([['capture','one'],['drain','one']]);expect(state.roomCaptureBusy).toBe(false);expect(state.roomCaptureAgain).toBe(false);expect(state.roomCaptureTimer).toBeNull();
});
it('captures the current account on dispatch and does not overlap in-flight writes',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),{host,state}=fixture({captureRoom:vi.fn(()=>pending)});
 native.app_room_capture_schedule(host,32);state.driveProfile={id:'two'};await vi.advanceTimersByTimeAsync(32);expect(host.captureRoom).toHaveBeenCalledWith('two');expect(state.roomCaptureBusy).toBe(true);
 native.app_room_capture_schedule(host,32);native.app_room_capture_schedule(host,32);expect(vi.getTimerCount()).toBe(0);state.driveProfile={id:'three'};release();await tick();expect(host.drainLive).toHaveBeenCalledWith('two');expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(32);expect(host.captureRoom.mock.calls.map(a=>a[0])).toEqual(['two','three']);
});
it('retries capture and drain failures with the original bounded backoff',async()=>{
 const error=Error('network'),{host,state}=fixture({captureRoom:vi.fn(async()=>{throw error;})});
 native.app_room_capture_schedule(host,32);await vi.advanceTimersByTimeAsync(32);expect(state.roomCaptureFailures).toBe(1);expect(host.drainLive).not.toHaveBeenCalled();
 for(const delay of [500,1000,2000,4000,8000,8000]){const before=host.captureRoom.mock.calls.length;await vi.advanceTimersByTimeAsync(delay-1);expect(host.captureRoom).toHaveBeenCalledTimes(before);await vi.advanceTimersByTimeAsync(1);expect(host.captureRoom).toHaveBeenCalledTimes(before+1);}
 expect(host.warnRoom).toHaveBeenCalledWith(error);host.captureRoom.mockResolvedValue(undefined);host.drainLive.mockRejectedValueOnce(error);await vi.advanceTimersByTimeAsync(8000);expect(state.roomCaptureAgain).toBe(true);await vi.advanceTimersByTimeAsync(8000);expect(state.roomCaptureFailures).toBe(0);expect(state.roomCaptureAgain).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it('ignores absent accounts without dropping a later requested room change',async()=>{
 const{host,state}=fixture();state.driveProfile=null;native.app_room_capture_schedule(host,32);expect(vi.getTimerCount()).toBe(0);expect(state.roomCaptureAgain).toBe(true);state.driveProfile={id:'new'};native.app_room_capture_schedule(host,32);state.driveProfile=null;await vi.advanceTimersByTimeAsync(32);expect(host.captureRoom).not.toHaveBeenCalled();expect(state.roomCaptureTimer).toBeNull();
});
it('schedules book changes only after the current account accepted them',()=>{
 const{host,state}=fixture();native.app_room_book_changed(host,'book',['progressFraction']);expect(host.markBookChanged).toHaveBeenCalledExactlyOnceWith('one','book',['progressFraction']);expect(vi.getTimerCount()).toBe(1);clearTimeout(state.roomCaptureTimer);state.roomCaptureTimer=null;host.markBookChanged.mockReturnValue(false);native.app_room_book_changed(host,'book',[]);expect(vi.getTimerCount()).toBe(0);state.driveProfile=null;host.markBookChanged.mockClear();native.app_room_book_changed(host,'book',[]);expect(host.markBookChanged).not.toHaveBeenCalled();
});
it('finalizes ownership and schedules a retry even when warning throws',async()=>{
 const warning=Error('warn'),{host,state}=fixture({captureRoom:vi.fn(async()=>{throw Error('capture');}),warnRoom:vi.fn(()=>{throw warning;})});
 await expect(native.app_room_capture_run(host)).rejects.toBe(warning);expect(state.roomCaptureBusy).toBe(false);expect(vi.getTimerCount()).toBe(1);clearTimeout(state.roomCaptureTimer);
});
