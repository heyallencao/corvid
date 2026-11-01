// URL glob syntax: * stays within a path segment, ** may cross segments,
// braces provide alternatives, and backslash escapes the following character.
export function urlMatcher(expected) {
  if (expected instanceof RegExp) {
    const expression = new RegExp(expected.source, expected.flags);
    return {description: expression.toString(), matches: url => {expression.lastIndex=0;return expression.test(url);}};
  }
  if (typeof expected === 'function') return {description: 'URL predicate', matches: url => {
    const value=expected(new URL(url));
    if (value && typeof value.then==='function') {Promise.resolve(value).catch(()=>{});throw new TypeError('URL predicate must be synchronous');}
    return Boolean(value);
  }};
  if (typeof expected !== 'string' || !expected) throw new TypeError('URL matcher must be a nonempty string, RegExp, or synchronous function');
  let source='', group=false;
  const literal=character=>character.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');
  for (let index=0;index<expected.length;index++) {
    const character=expected[index];
    if (character==='\\' && index+1<expected.length) {source+=literal(expected[++index]);continue;}
    if (character==='*') {
      let end=index;while(expected[end+1]==='*')end++;
      if(end===index) source+='[^/]*';
      else if(expected[end+1]==='/') {source+=index>0 && expected[index-1]==='/'?'(?:.*/)?':'.*/';end++;}
      else source+='.*';
      index=end;continue;
    }
    if(character==='{') {if(group)throw new TypeError('Nested URL glob group');group=true;source+='(?:';continue;}
    if(character==='}') {if(!group)throw new TypeError('Unmatched URL glob group');group=false;source+=')';continue;}
    if(character===',' && group) {source+='|';continue;}
    source+=literal(character);
  }
  if(group)throw new TypeError('Unmatched URL glob group');
  const expression=new RegExp(`^${source}$`);
  return {description:JSON.stringify(expected),matches:url=>expression.test(url)};
}
