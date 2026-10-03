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

def download_catalog():
    # Exact labels, classes, ancestry and bounds from run 37134892534's
    # authenticated android-background-download.xml (artifact 11278254005).
    return ElementTree.fromstring('''<hierarchy>
      <node class="android.app.Dialog" enabled="true" text="Escuchar" bounds="[0,398][1080,2217]">
        <node class="android.view.View" enabled="true" text="Voz natural" bounds="[55,184][1028,341]">
          <node class="android.widget.Button" enabled="true" clickable="true" text="Descargar la voz natural Lessac (63 MB)" bounds="[528,200][772,324]" />
        </node>
        <node class="android.view.View" enabled="true" text="Voces naturales" bounds="[55,959][1028,2191]">
          <node class="android.widget.ListView" enabled="true" bounds="[88,1039][995,2191]">
            <node class="android.view.View" enabled="true" bounds="[88,1039][995,1199]">
              <node class="android.widget.Button" enabled="true" clickable="true" text="Descargar la voz Lessac, Inglés (EE. UU.) (63 MB)" bounds="[739,1056][995,1179]" />
            </node>
          </node>
        </node>
      </node>
    </hierarchy>''')

def catalog_button(root):
    return next(node for node in root.iter('node') if node.get('text','').startswith('Descargar la voz Lessac,'))

class NativeMediaEvidenceTests(unittest.TestCase):
    def test_download_targets_the_visible_catalog_button_not_the_clipped_offer(self):
        with patch.object(verifier,'run') as command:
            label=verifier.tap(download_catalog(),verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True)
        self.assertEqual(label,'Descargar la voz Lessac, Inglés (EE. UU.) (63 MB)')
        command.assert_called_once_with('adb','shell','input','tap','867','1117')

    def test_catalog_download_rejects_disabled_nonclickable_and_nonbutton_rows(self):
        for changes in [{'enabled':'false'},{'clickable':'false'},{'class':'android.widget.TextView'}]:
            with self.subTest(changes=changes):
                root=download_catalog();catalog_button(root).attrib.update(changes)
                with patch.object(verifier,'run') as command:
                    self.assertIsNone(verifier.tap(root,verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True))
                command.assert_not_called()

    def test_missing_catalog_button_does_not_fall_back_to_the_initial_offer(self):
        root=download_catalog();catalog_button(root).set('text','Descargar la voz Cori, Inglés (Reino Unido) (114 MB)')
        with patch.object(verifier,'run') as command:
            self.assertIsNone(verifier.tap(root,verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True))
        command.assert_not_called()

    def test_catalog_without_the_real_dialog_never_downloads(self):
        for changes in [{'class':'android.view.View'},{'enabled':'false'},{'text':'Otro diálogo'}]:
            with self.subTest(changes=changes):
                root=download_catalog();root.find('node').attrib.update(changes)
                with patch.object(verifier,'run') as command:
                    self.assertIsNone(verifier.tap(root,verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True))
                command.assert_not_called()

    def test_catalog_button_must_fit_inside_both_visible_containers(self):
        for bounds in ['[739,200][995,324]','[739,930][995,1050]','[739,2150][995,2210]','[739,1056][995,1056]','invalid']:
            with self.subTest(bounds=bounds):
                root=download_catalog();catalog_button(root).set('bounds',bounds)
                with patch.object(verifier,'run') as command:
                    self.assertIsNone(verifier.tap(root,verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True))
                command.assert_not_called()

    def test_missing_or_disabled_natural_catalog_never_downloads(self):
        for changes in [{'text':'Voz natural'},{'enabled':'false'}]:
            with self.subTest(changes=changes):
                root=download_catalog();next(n for n in root.iter('node') if n.get('text')=='Voces naturales').attrib.update(changes)
                with patch.object(verifier,'run') as command:
                    self.assertIsNone(verifier.tap(root,verifier.LESSAC_DOWNLOAD_PATTERN,within_voice_catalog=True))
                command.assert_not_called()

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
