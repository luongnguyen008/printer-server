// Schema enums remain opaque API values; only display labels are translated.
const printOptionLabels = {PageSize:'Khổ giấy',Duplex:'In hai mặt',MediaType:'Loại giấy',InputSlot:'Khay giấy',Resolution:'Độ phân giải','print-scaling':'Căn nội dung PDF',BindEdge:'Cạnh đóng gáy',CNDraftMode:'Tiết kiệm mực',Collate:'Sắp bộ bản in'};
const printChoiceLabels = {BindEdge:{Left:'Trái',Top:'Trên'},Duplex:{None:'Một mặt',DuplexNoTumble:'Hai mặt · lật cạnh dài',DuplexTumble:'Hai mặt · lật cạnh ngắn'},'print-scaling':{auto:'Tự động theo CUPS', 'auto-fit':'Tự động thu vừa trang',fit:'Vừa vùng in · giữ toàn bộ nội dung',fill:'Lấp đầy vùng in · có thể cắt nội dung',none:'Giữ kích thước gốc'}};
function optionElement(tag,text){const el=document.createElement(tag);if(text!=null)el.textContent=String(text);return el;}
function choiceLabel(item,value){return printChoiceLabels[item.name]?.[value] || item.choices.find(c=>c.value===value)?.label || value;}
function validatePrintOptions(schema,values){for(const c of schema?.constraints||[])if(values[c.option1]===c.choice1&&values[c.option2]===c.choice2){const describe=(name,value)=>{const item=schema.options?.find(o=>o.name===name);return `${printOptionLabels[name]||item?.label||name}: ${item?choiceLabel(item,value):value}`;};return `${describe(c.option1,c.choice1)} không tương thích với ${describe(c.option2,c.choice2)}.`;}return '';}
function createPrintOptionsEditor(schema,{defaults={},allowed={},client=false,format='pdf'}={}){
  const root=optionElement('div');root.className='option-editor';
  const message=optionElement('p');message.className='muted';root.append(message);
  const options=(schema?.options||[]).filter(o=>o.name!=='PageRegion'&&Array.isArray(o.choices)&&o.choices.length);
  const usable=['available','partial'].includes(schema?.availability);
  const selects=new Map(),permits=new Map();
  if(!usable){message.className='bad';message.textContent=schema?.reason||'Chưa đọc được khả năng của máy in.';return {root,usable:false,validate:()=>message.textContent,payload:()=>({options:{}})};}
  const members=client&&format==='zpl'?[]:options;
  message.textContent=client?(format==='zpl'?'ZPL gửi nguyên bản. Không áp dụng tùy chọn PDF.':members.length?'Chỉ có thể đổi những giá trị quản trị đã cấp.':'Dùng cấu hình mặc định; quản trị chưa cấp tùy chọn để thay đổi.'):'Chọn mặc định và các giá trị client được phép đổi. Không chọn quyền nào nếu muốn giữ mặc định của driver.';
  if(schema.availability==='partial')message.textContent+=' CUPS chỉ báo một phần khả năng; không xác nhận các ràng buộc riêng của driver.';
  const unknownDefaults=Object.fromEntries(Object.entries(defaults).filter(([key,value])=>!options.some(o=>o.name===key&&o.choices.some(c=>c.value===value))));
  const unknownAllowed=Object.fromEntries(Object.entries(allowed).map(([key,values])=>[key,values.filter(value=>!options.some(o=>o.name===key&&o.choices.some(c=>c.value===value)))]).filter(([,values])=>values.length));
  let dropLegacy=null;
  if(!client&&(Object.keys(unknownDefaults).length||Object.keys(unknownAllowed).length)){
    const warning=optionElement('p','Có cấu hình cũ không được schema hiện tại xác nhận. Mặc định giữ nguyên; chỉ xóa khi bạn chủ động chọn dưới đây.');warning.className='bad';root.append(warning);
    const label=optionElement('label','Xóa các giá trị cũ không còn trong schema khi lưu');label.className='check';dropLegacy=optionElement('input');dropLegacy.type='checkbox';label.prepend(dropLegacy);root.append(label);
  }
  for(const group of ['common','advanced']){
    const items=members.filter(o=>(o.group==='advanced'?'advanced':'common')===group);if(!items.length)continue;
    const section=optionElement(group==='advanced'?'details':'section');section.className=group==='advanced'?'advanced option-advanced':'option-common';section.append(optionElement(group==='advanced'?'summary':'h3',group==='advanced'?'Tùy chọn driver nâng cao':'Tùy chọn thường dùng'));
    for(const item of items){
      const field=optionElement('fieldset');field.className='option-field';const title=printOptionLabels[item.name]||item.label||item.name;
      const legend=optionElement('legend',title);field.append(legend);
      addFieldHelp(legend,item.name==='print-scaling'?'Vừa vùng in giữ toàn bộ nội dung; lấp đầy có thể cắt mép. Không lựa chọn nào tạo khả năng in tràn lề. Máy laser thường vẫn có vùng không in được.':`Các giá trị do CUPS/driver báo cho ${item.name}. Client chỉ được đổi trong danh sách quản trị cấp. Giá trị mặc định được chụp cùng lệnh khi nhận, không tự đổi cho lệnh cũ.`);
      const current=defaults[item.name]??item.default??'';
      if(client&&item.choices.length===1&&item.choices[0].value===current){field.append(optionElement('p',`${choiceLabel(item,current)} · do quản trị cố định`));section.append(field);continue;}
      const select=optionElement('select');select.dataset.optionName=item.name;select.setAttribute('aria-label',`${title}: ${client?'lựa chọn':'giá trị mặc định'}`);
      const inherited=optionElement('option',client?`Dùng mặc định${current?` (${choiceLabel(item,current)})`:''}`:`Dùng mặc định driver${item.default?` (${choiceLabel(item,item.default)})`:''}`);inherited.value='';select.append(inherited);
      for(const choice of item.choices){const el=optionElement('option',choiceLabel(item,choice.value));el.value=choice.value;select.append(el);}
      select.value=client?'':defaults[item.name]||'';selects.set(item.name,select);field.append(select);
      if(!client){
        const rights=optionElement('details');rights.className='option-rights';rights.append(optionElement('summary','Giá trị client được phép chọn'));
        const list=optionElement('div');list.className='option-choices';
        for(const choice of item.choices){const label=optionElement('label',choiceLabel(item,choice.value));label.className='check option-choice';const check=optionElement('input');check.type='checkbox';check.value=choice.value;check.checked=(allowed[item.name]||[]).includes(choice.value);label.prepend(check);list.append(label);}
        function includeDefault(){if(select.value){const check=[...list.querySelectorAll('input')].find(c=>c.value===select.value);if(check)check.checked=true;}}
        select.addEventListener('change',includeDefault);list.addEventListener('change',includeDefault);rights.append(list);field.append(rights);permits.set(item.name,list);
        field.append(optionElement('small','Mặc định cố định luôn nằm trong quyền được phép. Chỉ một giá trị giống mặc định thì client không đổi được.'));
      }
      section.append(field);
    }
    root.append(section);
  }
  const technical=optionElement('details');technical.className='advanced';technical.append(optionElement('summary','Thông tin kỹ thuật'),optionElement('pre',JSON.stringify({source:schema.source,schema_fingerprint:schema.schema_fingerprint,mapping_fingerprint:schema.mapping_fingerprint,...(!client?{unknownDefaults,unknownAllowed}:{})},null,2)));root.append(technical);
  function payload(){
    const values=Object.fromEntries([...selects].filter(([,el])=>el.value).map(([key,el])=>[key,el.value]));
    if(client)return {options:format==='pdf'?values:{}};
    const nextDefaults=dropLegacy?.checked?{}:{...unknownDefaults},nextAllowed=dropLegacy?.checked?{}:Object.fromEntries(Object.entries(unknownAllowed).map(([key,values])=>[key,[...values]]));
    Object.assign(nextDefaults,values);
    for(const [name,list] of permits){const choices=[...list.querySelectorAll('input:checked')].map(c=>c.value);const merged=[...new Set([...(nextAllowed[name]||[]),...choices])];if(merged.length)nextAllowed[name]=merged;}
    return {default_options:nextDefaults,allowed_options:nextAllowed};
  }
  function validate(){if(client&&format==='zpl')return '';const p=payload();const driver=Object.fromEntries(options.filter(o=>o.default).map(o=>[o.name,o.default]));const effective=client?{...driver,...(schema.default_options||{}),...defaults,...p.options}:{...driver,...p.default_options};return validatePrintOptions(schema,effective);}
  const conflict=optionElement('p');conflict.className='bad';conflict.setAttribute('role','alert');conflict.hidden=true;root.append(conflict);
  root.addEventListener('change',()=>{const error=validate();conflict.textContent=error;conflict.hidden=!error;if(error){const advanced=root.querySelector('.option-advanced');if(advanced)advanced.open=true;}});
  return {root,usable,payload,validate};
}
