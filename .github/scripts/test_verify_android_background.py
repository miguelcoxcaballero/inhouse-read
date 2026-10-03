import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree
from unittest.mock import patch
import verify_android_background as verifier
from audiobook_fixture import write_audiobook, write_background_pdf

def evidence():
    states=[dict(session='a',epoch=1,active=True,wakeHeld=True,interactive=False,playedFrames=i*22050,sampleRate=22050,elapsedMs=i*1000) for i in (0,100,200,361)]
    events=[dict(session='a',type='start',unit=i) for i in range(12)]+[dict(session='a',type='done',unit=i) for i in range(11)]
    progress=[dict(session='a',kind='chapter',interactive=False,chapter=i) for i in range(3)]
    return 'enqueue session=a epoch=1 unit=1 peak=0.8 rms=0.06',states,events,progress

class NativeMediaEvidenceTests(unittest.TestCase):
    def test_voice_menu_uses_the_real_clickable_button_not_the_offer_group(self):
        # Exact labels/bounds/classes from the authenticated Android15 failure.
        # The non-clickable group's centre lands on its Download child.
        root=ElementTree.fromstring('''<hierarchy>
          <node class="android.view.View" enabled="true" clickable="false" text="Voz natural" bounds="[55,1223][1028,1380]">
            <node class="android.widget.TextView" enabled="true" clickable="false" text="Voz natural · 63 MB" bounds="[90,1276][519,1328]" />
            <node class="android.widget.Button" enabled="true" clickable="true" text="Descargar la voz natural Lessac (63 MB)" bounds="[528,1237][772,1364]" />
          </node>
          <node class="android.widget.Button" enabled="true" clickable="true" text="Voz Sin voces instaladas" bounds="[55,1713][1028,1859]" />
        </hierarchy>''')
        with patch.object(verifier,'run') as command:
            label=verifier.tap(root,r'^Voz(?:\s|$)',require_button=True)
        self.assertEqual(label,'Voz Sin voces instaladas')
        command.assert_called_once_with('adb','shell','input','tap','541','1786')

    def test_menu_requires_an_enabled_clickable_button_and_retains_the_language_row(self):
        root=ElementTree.fromstring('''<hierarchy>
          <node class="android.widget.TextView" enabled="true" clickable="false" text="Idioma" bounds="[55,1200][300,1250]" />
          <node class="android.widget.Button" enabled="false" clickable="true" text="Idioma viejo" bounds="[55,1400][1028,1450]" />
          <node class="android.widget.Button" enabled="true" clickable="false" text="Idioma no interactivo" bounds="[55,1400][1028,1450]" />
          <node class="android.widget.Button" enabled="true" clickable="true" text="Idioma Automática · Inglés" bounds="[55,1500][1028,1600]" />
        </hierarchy>''')
        with patch.object(verifier,'run') as command:
            self.assertEqual(verifier.tap(root,r'^Idioma(?:\s|$)',require_button=True),'Idioma Automática · Inglés')
        command.assert_called_once_with('adb','shell','input','tap','541','1550')

    def test_requires_real_clock_frames_chapters_and_non_silent_pcm(self):
        raw,states,events,progress=evidence()
        result=verifier.locked_metrics(raw,states,events,progress,'a')
        self.assertEqual(result['lockedWallMs'],361000)
        self.assertEqual(result['chapters'],[0,1,2])
        self.assertEqual(result['renderedAudioSeconds'],361)

    def test_rejects_no_rendered_pcm_despite_clock_and_wakelock(self):
        raw,states,events,progress=evidence()
        for state in states:state['playedFrames']=0
        with self.assertRaisesRegex(AssertionError,'PCM'):verifier.locked_metrics(raw,states,events,progress,'a')

    def test_rejects_old_session_or_visible_chapters(self):
        raw,states,events,progress=evidence()
        for item in progress:item['interactive']=True
        with self.assertRaisesRegex(AssertionError,'spine'):verifier.locked_metrics(raw,states,events,progress,'a')
        with self.assertRaisesRegex(AssertionError,'locked'):verifier.locked_metrics(raw,states,events,progress,'old')

    def test_rejects_native_error_or_device_silence(self):
        raw,states,events,progress=evidence()
        events.append(dict(session='a',type='error',unit=8,reason='native-playback-failed'))
        with self.assertRaisesRegex(AssertionError,'errors'):verifier.locked_metrics(raw,states,events,progress,'a')
        with self.assertRaisesRegex(AssertionError,'silent'):verifier.locked_metrics(raw.replace('peak=0.8 rms=0.06','peak=0.0 rms=0.0'),states,events[:-1],progress,'a')

    def test_rejects_a_reversed_head_and_released_active_wakelock(self):
        raw,states,events,progress=evidence();states[2]['playedFrames']=1
        with self.assertRaisesRegex(AssertionError,'backwards'):verifier.locked_metrics(raw,states,events,progress,'a')
        raw,states,events,progress=evidence();states[1]['wakeHeld']=False
        with self.assertRaisesRegex(AssertionError,'wake lock'):verifier.locked_metrics(raw,states,events,progress,'a')

    def test_sender_fixtures_have_real_multi_page_and_multi_spine_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            epub=Path(directory)/'book.epub';pdf=Path(directory)/'book.pdf'
            write_audiobook(epub);write_background_pdf(pdf)
            with ZipFile(epub) as book:
                self.assertEqual(book.read('mimetype'),b'application/epub+zip')
                self.assertEqual(len(ElementTree.fromstring(book.read('content.opf')).find('{http://www.idpf.org/2007/opf}spine')),24)
                self.assertIn(b'This is chapter 24',book.read('c23.xhtml'))
            self.assertTrue(pdf.read_bytes().startswith(b'%PDF-1.4'))
            self.assertIn(b'/Count 4',pdf.read_bytes());self.assertIn(b'physical page 4',pdf.read_bytes())

if __name__=='__main__':unittest.main()
