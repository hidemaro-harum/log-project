function wrapper_fixture_(value) {
  return value;
}

var rendered = `raw_outer_helper_() ${wrapper_fixture_({
  nested: `raw_inner_helper_() ${missing_nested_template_()}`
})}`;
