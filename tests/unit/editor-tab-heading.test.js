import {afterEach, describe, expect, it} from 'vitest';
import {setEditorTabHeading} from '../../src/js/editor-tab-heading.js';
afterEach(() => document.body.replaceChildren());
function fixture() {
 const heading=document.createElement('h2');heading.textContent='Portada';
 const list=document.createElement('div');list.setAttribute('role','tablist');
 const buttons=['Lomo','Portada'].map(text=>{const button=document.createElement('button');button.textContent=text;button.setAttribute('role','tab');list.append(button);return button;});
 document.body.append(heading,list);return {heading,list,buttons};
}
describe('visible active editor heading',()=>{
 it('uses the actual active tab instead of an invisible unrelated target',()=>{
  const {heading,list,buttons}=fixture();setEditorTabHeading(heading,buttons[1]);
  expect(heading.textContent).toBe('Portada');expect(heading.parentElement).toBe(list);
  expect(buttons[1].closest('h2')).toBe(heading);expect(buttons[0].closest('h2')).toBeNull();
  expect(document.querySelectorAll('h2')).toHaveLength(1);
 });
 it('retains button identity, listeners, order and keyboard focus across switches',()=>{
  const {heading,list,buttons}=fixture();let clicks=0;buttons[1].onclick=()=>clicks++;
  buttons[0].focus();setEditorTabHeading(heading,buttons[0]);expect(document.activeElement).toBe(buttons[0]);
  buttons[1].focus();setEditorTabHeading(heading,buttons[1]);
  expect(document.activeElement).toBe(buttons[1]);expect([...list.querySelectorAll('button')]).toEqual(buttons);
  buttons[1].click();expect(clicks).toBe(1);expect(heading.textContent).toBe('Portada');
  setEditorTabHeading(heading,buttons[0]);expect(heading.textContent).toBe('Lomo');
 });
 it('does not remount the selected tab or take focus from a text field',()=>{
  const {heading,buttons}=fixture();setEditorTabHeading(heading,buttons[0]);
  const input=document.createElement('input');document.body.append(input);input.focus();
  setEditorTabHeading(heading,buttons[0]);expect(document.activeElement).toBe(input);
  setEditorTabHeading(heading,buttons[1]);expect(document.activeElement).toBe(input);
 });
});
