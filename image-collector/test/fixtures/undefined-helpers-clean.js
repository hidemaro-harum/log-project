function declared_fixture_() {}

// missing_line_comment_()
/* missing_block_comment_() */
var singleQuoted = 'missing_single_quote_()';
var doubleQuoted = "missing_double_quote_()";
var regexLiteral = /missing_regex_\(["']/;
var rawTemplate = `missing_raw_template_()`;
var objectCall = service.object_helper_();

if (true) /missing_after_condition_(group)/.test("missing_group");
declared_fixture_();
