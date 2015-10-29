/*
config = {
   skip: <string> or <Regex> or [<pattern>] or { pattern_name: <pattern>}::not support now
   returnMode: "value" or "token"
}
*/
var scanner = function (text, config) {
    config = config || {}

    var _lastIndex = text.length - 1
    var _currentIndex = 0
    var _records = []
    var _transactions = []
    var _currentTokens = []
    var _tokenSet = []
    
    var _lastpeek
    var _lastToken
    var _lastskipped

    //helper
    var _regex = {}

    var Token
    
    if (config.mode === 'token') {
        Token = function (text, start, end) {
            return {
                __text: text,
                __start: start !== undefined ? start : _currentIndex - text.length,
                __end: end !== undefined ? end : _currentIndex
            }
        }
    }
    else {
        
        Token = function (text) {
            return text
        }
    }

    var isEndOfStream_impl = function () {
        return _currentIndex > _lastIndex
    }

    var peek_impl = function (pattern, isNotSetToken) {
        pattern = pattern || 1

        _lastpeek = undefined

        if (typeof pattern === 'number') {
            if (_currentIndex + pattern - 1 <= _lastIndex) {
                _lastpeek = text.substr(_currentIndex, pattern)
                
                //success
                
            }

        }
        else if (typeof pattern === 'string') {
            if (_currentIndex + pattern.length - 1 <= _lastIndex && text.substr(_currentIndex, pattern.length) === pattern) {
                _lastpeek = pattern
                
                //success
                
            }
        }
        else if (pattern.constructor.name === 'RegExp') {

            if ((realPattern = _regex[pattern.source]) === undefined) {
                realPattern = new RegExp("^" + pattern.source, pattern.ignoreCase ? "i" : "")
                _regex[pattern.source] = realPattern
            }
            if (!isEndOfStream_impl()) {
                var match = rest_impl().match(realPattern)
                if (match) {
                    //success
                    _lastpeek = match[0]


                }
            }
        }

        if (_lastpeek !== undefined && isNotSetToken === undefined) {
            _lastToken = Token(_lastpeek, _currentIndex, _currentIndex + _lastpeek.length)
            return _lastpeek
        }
        
    }

    var skip

    if (config.skip) {
        var skip_patterns
        if (Array.isArray(config.skip)) {
            skip_patterns = config.skip
        }
        else if (typeof config.skip === 'string' || config.skip.constructor.name === 'RegExp') {
            skip_patterns = [config.skip]
        }

        skip = function () {
            var skipped = ""

            while (true) {
                var isSkipped = skip_patterns.some(function (p) {
                    peek_impl(p, true)

                    if (_lastpeek !== undefined) {
                        _currentIndex += _lastpeek.length
                        skipped += _lastpeek
                        return true
                    }
                    else {
                        return false
                    }
                })

                if (isSkipped) {
                    continue
                }
                else {
                    break
                }

            }

            return skipped
        }
    }
    else {
        skip = function () {
            return ""
        }
    }

    var move_impl =  function () {
        _currentIndex += _lastpeek.length
        var skipped = skip()
        _lastskipped = skipped

        _lastToken['__skip'] = skipped
        
        _currentTokens.push(_lastToken)
            
    }

    var rest_impl = function () {
        if (_currentIndex <= _lastIndex) {
            return text.substr(_currentIndex)
        }
        else {
            return undefined
        }
    }

   

    var to = function (index) {
        _currentIndex = index
    }

    //skip the head
    var _skippedHead = skip()
    


    return {
        peek: peek_impl,
        next: function (pattern) {
            if (this.peek(pattern) != undefined) {
                this.move()
                return _lastToken
            }
        },
        move:move_impl,
        beginTx: function () {
            _tokenSet.push(_currentTokens)
            _currentTokens = []
            _transactions.push(_currentIndex)
            return this
        },
        commit:function () {
            _transactions.pop()
            _currentTokens = _tokenSet.pop().concat(_currentTokens)
            return this
        },
        rollback: function () {
            _currentTokens = _tokenSet.pop()
            to(_transactions.pop())
            return this
        },

        //begin record
        beginRd: function (offset) {
            offset = offset || 0
            _records.push(_currentIndex + offset)
            return this
        },
        fetch: function (offset) {
            offset = offset || 0
            var start = _records.pop()
            var end = _currentIndex + offset
            return Token(text.substring(start, end),start, end)
        },
        dropRd:function () {
            _records.pop()
        },
        text: function (startIndex) {
            return text.substring(startIndex,_currentIndex)
        },
        get lastpeek() {
            return _lastpeek
        },
        get lastToken(){
            return _lastToken
        },
        get isEndOfStream() {
            return isEndOfStream_impl()
        },
        get rest() {
            return rest_impl()
            
        },
        get tokens() {
            return _tokenSet.reduce(function (pre,cur) {
                return pre.concat(cur)
            },[]).concat(_currentTokens)
        },
        get skippedHead(){
            return _skippedHead
        },
        get mode(){
            return config.mode
        },

        get currentIndex(){
            return _currentIndex
        },
        get rawText(){
            return text
        },
        //plugins
        balance:function (left, right, escapePattern) {
            right = right || left
            if (this.peek(left) !== undefined) {
                var isSuccess = false
                var counter = 0
                this.beginTx()
                this.beginRd()
                while (!this.isEndOfStream) {
                    if (escapePattern !== undefined && this.peek(escapePattern) !== undefined) {
                        this.move()
                    }
                    else if (this.peek(left)) {
                        counter++
                        this.move()
                    }
                    else if (this.peek(right)) {
                        counter--
                        
                        if (counter === 0) {
                            isSuccess = true
                            break
                        }
                        else {
                            this.move()
                        }
                    }
                    else {
                        this.next()
                    }
                }

                if (isSuccess) {
                    this.commit()
                    var extract = this.fetch()
                    var fetched = extract.substr(left.length, extract.length - left.length)
                    this.move()

                    return fetched
                }
                else {
                    this.rollback()
                }

            }else{
                //failed
                return
            }

        }
    }



}

var grammarType = {
    option:0,
    composite: 1,
    branch: 2,
    token: 3
}

var subType = {
    named: 0,
    anonymous : 1
}


var grammar = function () {


    var parse_grammar = function (grammar) {
        return {
            includes:grammar.includes || [],
            name: grammar.name,
            lexer: parse_lexer(grammar.lexer),
            parser: parse_parser(grammar.parser),
            config: grammar.config || {}
        }
    }


    var parse_lexer = function (lexer) {
        var token_repo = {}
        for (var p in lexer) {
            token_repo[p] = {
                name: p,
                pattern: lexer[p]
            }
        }
        return token_repo
    }

    var parse_parser = function (parser) {
        var option_repo = {}
        for (var p in parser) {
            option_repo[p] =  parse_option(p, parser[p])

        }
        return option_repo
    }

    var parse_option = function (option_name, branches) {
        var branches_config = branches.map(function (b, i) {
            var name, text

            if (Array.isArray(b)) {
                name = b[1]
                text = b[0]
            }
            else {
                name = i
                text = b
            }

            return parse_branch(option_name, name, text)
        })

        var branch_map = branches_config.reduce(function (pre, cur) {
            pre[cur.name] = cur
            return pre
        }, {})
        var left_self_rec_branches = branches_config.filter(function (b) {
            return b.isLeftSelfRec
        })

        return {
            name: option_name,
            type:grammarType.option,
            branches: branches_config,
            isLeftSelfRec: branches_config.some(function (b) {
                return b.isLeftSelfRec
            }),
            get_branch: function (name) {
                return branch_map[name]
            },
            leftSelfRecBranches: left_self_rec_branches
        }
    }

    //sample text: "test '(' (id:name ':' expr:value):props[] (',' id:key ':' expr:value)*:props[] ')'"
    var parse_branch = function (option_name, branch_name, text) {
        var composite = parse_composite(text)

        return {
            option: option_name,
            name: branch_name,
            type:grammarType.branch,
            config: composite,
            isLeftSelfRec: composite.config[0].config === option_name
        }
    }

    var parse_unit = function (scan) {
        var unit

        //parse component
        if (scan.peek(/[A-Z_][A-Z_\d]*/)) {
            //Named Lexer
            unit = parse_named_token(scan)
        }
        else if (scan.peek(/'/)) {
            unit = parse_anonymous_token(scan)
        }
        else if (scan.peek(/[a-z_]\w*/)) {
            unit = parse_option_ref(scan)
        }
        else if (scan.peek('(')) {
            // composite
            var compositeExpr = scan.balance("(", ")", /'(\\'|[^'])*'/)
            unit = parse_composite(compositeExpr)
        }

        //parse quantifier
        var quantifier = parse_quantifier(scan)
        if (quantifier !== undefined) {
            unit.quantifier = quantifier
        }

        //parse ast config
        if (scan.peek(":")) {
            scan.move()
            if (scan.peek("=")) {
                scan.move()
                if (scan.peek("_")) {
                    scan.move()
                    unit.ast = "replace"
                }
                else {
                    unit.ast = parse_ast(scan)
                }
            }
            else {
                unit.ast = "skip"
            }
        }

        //populate default ast

        return unit
    }

    var parse_named_token = function (scan) {
        var token_name = scan.lastpeek
        scan.move()
        return {
            config: token_name,
            type: grammarType.token,
            subType: subType.named
        }
    }

    var parse_option_ref = function (scan) {
        var option_name = scan.lastpeek
        scan.move()
        return {
            config: option_name,
            type: grammarType.option,
            subType: subType.named
        }
    }

    var parse_anonymous_token = function (scan) {
        scan.move()
        var token_pattern = scan.peek(/(\\'|[^'])*/)
        scan.move()
        scan.next("'")
        return {
            config: {pattern: token_pattern},
            type: grammarType.token,
            subType: subType.anonymous
        }
    }

    var parse_composite = function (text) {
        var scan = scanner(text, { skip: /\s/ })
        var parts = []
        while (!scan.isEndOfStream) {
            parts.push(parse_unit(scan))
        }

        return {
            config: parts,
            type: grammarType.composite
        }
    }

    var parse_quantifier = function (scan) {
        var quantifier

        if (scan.peek("*") !== undefined) {
            quantifier = {
                Lbound: 0,
                Ubound: -1 // means no bound
            }
            scan.move()
        }
        else if (scan.peek("?") !== undefined) {
            quantifier = {
                Lbound: 0,
                Ubound: 1
            }
            scan.move()
        }
        else if (scan.peek("+") !== undefined) {
            quantifier = {
                Lbound: 1,
                Ubound: -1
            }
            scan.move()
        }
        else if (scan.peek("{")) {
            scan.move()
            var Lbound = scan.next(/\d+/)
            scan.next(",")
            var Ubound = scan.next(/\d+/)
            scan.next("}")
            quantifier = {
                Lbound: Lbound,
                Ubound: Ubound
            }
        }

        return quantifier
    }

    var parse_ast = function (scan) {
        var path = scan.next(/[\w]+/)
        var array = scan.next(/\[\]/)
        return {
            path: path,
            isArray: array !== undefined
        }
    }

    //helper
    var copy_grammar = function (origin, target) {
        for (var name in origin.lexer) {
            target.lexer[name] = origin.lexer[name]
        }

        for (var name in origin.parser) {
            target.parser[name] = origin.parser[name]
        }

        target.config = origin.config
    }

    var update_reference = function (merged_repo) {
        var lexer = merged_repo.lexer
        var parser = merged_repo.parser

        var recursive_update_unit_reference = function (unit) {
            if (unit.type == grammarType.token && unit.subType == subType.named) {
                var config = lexer[unit.config]

                if (config === undefined) {
                    throw new Error("can't find token: [" + config + "]")
                }

                unit.config = config
            }
            else if (unit.type == grammarType.option) {
                var config = parser[unit.config]

                if (config === undefined) {
                    throw new Error("can't find parser: [" + config + "]")
                }

                unit.config = config
            }
            else if (unit.type == grammarType.composite) {
                unit.config.forEach(function (sub_unit) {
                    recursive_update_unit_reference(sub_unit)
                })
            }
        }

        for (var name in parser) {
            parser[name].branches.forEach(function (b) {
                recursive_update_unit_reference(b.config)
            })
        }
    }

    //TODO: maybe not suitable to put here, move to a new place
    var update_ast_config = function (parsers) {
        for (var name in parsers) {
            parsers[name].branches.forEach(function (b) {
                update_unit_ast_config(b.config)
            })
        }
    }

    var update_unit_ast_config = function (unit) {
        if (unit.type === grammarType.composite) {
            unit.config.forEach(function (sub_unit) {
                update_unit_ast_config(sub_unit)
            })
        }
        else if (unit.ast === undefined) {
            if (unit.type === grammarType.token && unit.subType === subType.named || unit.type === grammarType.option) {
                unit.ast = {
                    path: unit.config.name,
                    isArray: false
                }
            }
        }
    }
    


    //store grammars
    var grammar_repo = {

    }

    return {
        register: function (grammar) {
            grammar_repo[grammar.name] =  parse_grammar(grammar)
        },
        getMergedGrammar: function (grammar_name) {
            var mergedRepo = {
                name: grammar_name,
                lexer: {},
                parser: {},
                config: {},
            }

            var g = grammar_repo[grammar_name]

            if (g === undefined) {
                throw new  Error("can't find grammar: [" + grammar_name +"]")
            }

            //the new include will override old definition
            g.includes.forEach(function (ref_gram_name) {
                var ref_gram = grammar_repo[ref_gram_name]

                if (ref_gram === undefined) {
                    throw new Error("can't find grammar [" + grammar_name + "]'s reference: " + "[" + ref_gram_name + "]")
                }

                copy_grammar(ref_gram,mergedRepo)
            })

            copy_grammar(g,mergedRepo)

            //set default config value
            if (mergedRepo.config.mode === undefined) {
                mergedRepo.config.mode = "text"
            }


            //update all reference config
            update_reference(mergedRepo)

            //update all ast config(set undefined as default: named token and option will set {path = *.name, isArray = false})
            update_ast_config(mergedRepo.parser)
            return mergedRepo
        }
    }

}

var raw_parser = function (grammar_merged) {
   

    var grammar = grammar_merged
    var mode = grammar.config.mode
    var matcherCreator = function (scanner) {
        var left_self_rec_matcher_factory = function (creator, higher_matcher_factory, branch) {
          
            return function () {
                var parts = branch.config.config
                var first = parts[0]
                var rest = parts.slice(1)

                var isFirst = true
                var _matcher

                

                return {
                    get count() { return _counter },
                    next: function () {

                        if (isFirst) {
                           
                            _matcher = creator.composite([higher_matcher_factory(), creator.quantifier(
                                function () {
                                    return creator.composite(rest.map(function (sub_unit) {
                                        return sub_unit.type == grammarType.option && sub_unit.config.name === branch.option ? higher_matcher_factory() : creator.unit(sub_unit)
                                    }))
                                },
                                {Lbound:0, Ubound:-1}
                                )])
                            isFirst = false
                        }

                        var match = _matcher.next()

                        if (match !== undefined) {
                            

                            var result = {
                                branch: branch.name,
                                option: branch.option,
                                value: match,
                                __type:grammarType.option
                            }

                            

                            return result
                        }
                    },
                    reset: function () {
                        isFirst = true
                        _matcher.reset()
                    }

                }
            }
        }


        return {
            token: function (token) {
                var isEnd = false
                var isSuccess = false
                return {
                    next: function () {
                        if (isEnd) {
                            if (isSuccess) {
                                scanner.rollback()
                                isSuccess = false
                            }
                            
                            return
                        }

                        var result

                        if (scanner.peek(token.pattern) !== undefined) {
                            result = scanner.lastToken
                            isSuccess = true
                            scanner.beginTx().move()
                        }

                        isEnd = true

                        return result
                    },
                    reset: function () {
                        isEnd = false
                        
                    }
                }
            },
            composite: function (subMatchers) {
                var _currentIndex = 0
                var _uBound = subMatchers.length
                var isEnd = false
                var isSuccess = false

                var result = []

                return {
                    next: function () {
                        if (isEnd) {
                            return
                        }
                        scanner.beginRd()
                        var composite_match

                        while (_currentIndex > -1 && _currentIndex < _uBound) {
                            var curMatcher = subMatchers[_currentIndex]
                            var match = curMatcher.next()
                            if (match !== undefined) {
                                result[_currentIndex] = match
                                _currentIndex++
                            }
                            else {
                                curMatcher.reset()
                                _currentIndex--
                            }
                        }

                        if (_currentIndex == _uBound) {
                            //success
                            
                            composite_match = result
                            
                            isSuccess = true
                            _currentIndex--
                            
                        }
                        else {
                            //fail
                            isEnd = true
                            scanner.dropRd()
                        }

                        return composite_match
                    },
                    reset: function () {
                        isEnd = false
                        
                        if (isSuccess) {
                            subMatchers.forEach(function (matcher) {
                                matcher.reset()
                            })
                        }
                        isSuccess = false
                        _currentIndex = 0
                        result = []
                    }
                }
            },
            quantifier: function (matcherFacotory, quantifier) {
                var Lbound = quantifier.Lbound - 1
                var Ubound = quantifier.Ubound - 1

                var isEnd = false
                var isSuccess = false
                var isFirst = true

                var _currentIndex = 0
                var _matchers = []
                var result = []

                var firstTime = function () {
                    if (isFirst) {
                        _matchers.push(matcherFacotory())
                        isFirst = false
                    }
                }
                

                var next_last_match = function () {
                   

                   
                   if (_matchers.length == 0) {
                       _currentIndex--
                   }
                   else {
                       var lastMatcher = _matchers.pop()
                       result.pop()
                       var match = lastMatcher.next()
                       if (match === undefined) {
                           _currentIndex--
                           
                       }
                       else {
                           _matchers.push(lastMatcher)
                           result[_currentIndex] = match
                           _currentIndex++
                           match_as_most_as_it_can()
                           _currentIndex--
                       }
                   }

                }

                var match_as_most_as_it_can = function () {
                    while (IsUboundNotReach()) {
                        var matcher = matcherFacotory()
                        var match = matcher.next()
                        if (match !== undefined) {
                            result[_currentIndex] = match
                            _matchers.push(matcher)
                            _currentIndex++
                        }
                        else {
                            
                            break
                        }
                    }
                    
                }

                var next_impl = function () {
                    
                    firstTime()

                    do {
                        next_last_match()
                    } while (!IsLboundFullFill() && canMatch());

                              
                }

                var canMatch = function () {
                    return _currentIndex >=0
                }
               
                var IsLboundFullFill = function () {
                    return Lbound <= _currentIndex
                }
                


                var IsUboundNotReach = function () {
                    if (Ubound == -2) {
                        return true
                    }
                    else {
                        return _currentIndex <= Ubound
                    }
                }

                return {
                    next: function () {
                        if (isEnd) {
                            return
                        }

                        isSuccess = false
                        
                        next_impl()
                        if (_currentIndex >= Lbound) {
                            isSuccess = true
                        }
                        else {
                            isEnd = true
                        }

                        if (isSuccess) {
                            var match = result

                           

                            if (result.length == 0 && Lbound == -1) {
                                isEnd = true
                            }

                            return match
                        }
                        

                        
                    },
                    reset: function () {
                        if (isSuccess) {
                            _matchers.forEach(function (m) {
                                m.reset()
                            })
                        }
                        isFirst = true
                        isSuccess = false
                        isEnd = false
                        _currentIndex = 0
                        _matchers = []
                        result = []
                    }
                }
            },
            branch: function (option_name,names,sub_matchers) {
                var _currentIndex = 0
                var Ubound = sub_matchers.length - 1

                var isFirst = true
                var isEnd = false
                var isSuccess = false

                return {
                    next: function () {
                        if (isEnd) {
                            return
                        }

                        isSuccess = false

                        if (isFirst) {
                            
                            isFirst = false
                        }

                        var match
                        while (_currentIndex <= Ubound) {
                            match = sub_matchers[_currentIndex].next()
                            if (match !== undefined) {
                                isSuccess = true
                                break
                            }
                            else {
                                _currentIndex++
                            }
                        }

                        if (isSuccess) {
                            var result = {
                                option:option_name,
                                branch: names[_currentIndex],
                                value: match,
                                __type:grammarType.option
                            }

                            

                            return result
                        }
                        else {
                            isEnd = true
                        }
                    },
                    reset: function () {
                        if (isSuccess) {
                            sub_matchers[_currentIndex].reset()
                            isSuccess = false
                        }
                        
                        isEnd = false
                        isFirst = true
                        _currentIndex = 0
                        

                    }
                }
            },
            unit: function (unit) {
                var matcherFactory
                var matcher
                var creator = this

                switch(unit.type){
                    case grammarType.token:
                        matcherFactory = function () {
                            return creator.token(unit.config)
                        }
                        break
                    case grammarType.option:
                        matcherFactory = function () {
                            return matcher = creator.option(unit.config)
                        }
                        
                        break
                    case grammarType.composite:
                        matcherFactory = function () {
                            return matcher = creator.composite(unit.config.map(function (sub_unit) {
                                return creator.unit(sub_unit)
                            }))
                        }
                        
                        break
                }

                if (unit.quantifier) {
                    matcher = creator.quantifier(matcherFactory,unit.quantifier)
                }
                else {
                    matcher = matcherFactory()
                }

                return matcher
            },
            option: function (option) {
                var option_name = option.name

                var self_ref_branches  = option.branches.filter(function (b) {
                    return b.isLeftSelfRec
                })

                var none_ref_branch = option.branches.filter(function (b) {
                    return !b.isLeftSelfRec
                })

                var creator = this
                var none_ref_branch_matcher_factory = function () {
                    return creator.branch(option_name,none_ref_branch.map(function (b) {
                        return b.name
                    }), none_ref_branch.map(function (b) {
                        return creator.unit(b.config)
                    }))
                }

                var option_factory = self_ref_branches.reduce(function (pre,branch) {
                    return left_self_rec_matcher_factory(creator, pre, branch)
                },none_ref_branch_matcher_factory)

                return option_factory()
            }

      
        }
    }

    return {
        parse: function (sourceCode, root) {
            var scan = scanner(sourceCode, grammar_merged.config)
            var matcher_creator = matcherCreator(scan)
            
            var matcher = matcher_creator.option(grammar_merged.parser[root])
            return matcher.next()
        },
        tokens: function (sourceCode, root) {
            var scan = scanner(sourceCode, grammar_merged.config)
            var matcher_creator = matcherCreator(scan)

            var matcher = matcher_creator.option(grammar_merged.parser[root])
            matcher.next()
            return {
                skippedHead: scan.skippedHead,
                tokens: scan.tokens
            }
        }


    }

}

var helper = {
    add_to_ast: function (new_ast, part, astConfig) {
        var target
        if (astConfig === undefined || astConfig == "skip") {
        }
        else if (astConfig === "replace") {
            new_ast = part
        }
        else if (astConfig.isArray) {
            var target = new_ast[astConfig.path]
            if (target === undefined) {
                target = new_ast[astConfig.path] = []
            }
            
            target.push(part)
        }
        else {
            var target = new_ast[astConfig.path]
            if (target === undefined) {
                new_ast[astConfig.path] = part
            }
            else if (Array.isArray(target)) {
                target.push(part)
            }
            else {
                new_ast[astConfig.path] = [target]
                new_ast[astConfig.path].push(part)
            }
        }
       return new_ast
    }
}

var basic_ast_rewritor = function (option) {
    //depends on differnt mode, we need to use getValue function to get the real ast elements
    //text mode
    var getValue = function (raw_ast) {
        
        return raw_ast
    }


    var advance_get_branch_ast = function (get_high_level_branch_ast_prev, branch) {
        return function (raw_ast) {
            return get_branch_ast(get_high_level_branch_ast_prev, raw_ast,branch)
        }
    }

    var get_branch_ast = function (get_high_level_branch_ast,raw_ast, branch) {
        var raw_ast = getValue(raw_ast)
        var option_name = branch.option
        var first_unit = branch.config.config[0]
        var rest_unit = branch.config.config.slice(1)


        var branch_ast

        //reduce situation
        if (raw_ast.value[1].length == 0) {
            branch_ast = get_high_level_branch_ast(raw_ast.value[0])
        }

        var first_ast = get_high_level_branch_ast(raw_ast.value[0])
        var ast = {}

        raw_ast.value[1].forEach(function (rest_asts) {            
            //TODO: think the logic here
           
             ast = helper.add_to_ast(ast, first_ast, first_unit.ast)
            
            

            rest_asts.forEach(function (rest_raw_ast,i) {
                //left self recursive
                
                if (rest_unit[i].type == grammarType.option && rest_unit[i].config.name === option_name) {
                    var part_ast = get_high_level_branch_ast(rest_raw_ast)
                    ast = helper.add_to_ast(ast, part_ast, rest_unit[i].ast)
                }
                else {
                    rewrite_unit(rest_asts[i],ast,rest_unit[i])
                }
            })
            ast.__option = option_name
            ast.__branch = branch.name

            first_ast = ast

            ast = {}
        })



        return first_ast
    }

    

    var rewrite_toekn = function (raw_ast,new_ast,token) {
        new_ast = helper.add_to_ast(new_ast, getValue(raw_ast), token.ast)
        return new_ast
    }

    var rewrite_composite = function (raw_ast, new_ast, composite) {
        var sub_units = composite.config
        if(composite.ast === undefined){
            sub_units.forEach(function (sub_unit,i) {
                new_ast = rewrite_unit(getValue(raw_ast)[i],new_ast, sub_unit)
            })
        }
        else if (composite.ast === "skip") {

        }
        else if (composite.ast === "replace") {
            var replace_ast = {}
            sub_units.forEach(function (sub_unit, i) {
                replace_ast = rewrite_unit(getValue(raw_ast)[i],replace_ast, sub_unit)
            })

            new_ast = replace_ast
        }//normal case
        else {
            var sub_ast = {}
            sub_units.forEach(function (sub_unit, i) {
                sub_ast = rewrite_unit(getValue(raw_ast)[i], sub_ast, sub_unit)
            })

            new_ast =  helper.add_to_ast(new_ast,sub_ast,composite.ast)
        }
        return new_ast
    }

    var rewrite_option = function (raw_ast,new_ast,option) {
        if (option.ast === "skip") {
            
        }
        else if(option.ast === 'repalce') {
            new_ast = get_option_ast(getValue(raw_ast), option.config)
        }
        else {
            new_ast = helper.add_to_ast(new_ast, get_option_ast(getValue(raw_ast),option.config),option.ast)
        }

        return new_ast
    }

    var get_option_ast = function (raw_ast,option) {
        var branch = option.get_branch(raw_ast.branch)
        var new_ast

        var get_non_left_self_rec_ast = function (raw_ast) {
            var raw_ast = getValue(raw_ast)
            var new_ast = {}
            var branch = option.get_branch(raw_ast.branch)
            new_ast = rewrite_composite(raw_ast.value,new_ast,branch.config)
            return {
                __branch: branch.name,
                __option:option.name,
                value: new_ast
            }
        }

        if (branch.isLeftSelfRec) {
            var get_left_self_rec_ast = option.leftSelfRecBranches.reduce(function (pre,cur) {
                return advance_get_branch_ast(pre,cur)
            }, get_non_left_self_rec_ast)
            new_ast = get_left_self_rec_ast(raw_ast)
        }
        else {
            new_ast = get_non_left_self_rec_ast(raw_ast)
        }

        return new_ast
    }

    var rewrite_unit = function (raw_ast, new_ast, unit) {
        
        //warning: chekcing if it's correct
        if (unit.quantifier !== undefined) {
            getValue(raw_ast).forEach(function (sub_raw_ast) {
                new_ast = rewrite_unit_noquantifier(sub_raw_ast, new_ast, unit)
            })

            return new_ast
        }
        else {
            return rewrite_unit_noquantifier(raw_ast, new_ast, unit)
        }
    }

    var rewrite_unit_noquantifier = function (raw_ast, new_ast, unit) {
        if (unit.type === grammarType.token) {
            return rewrite_toekn(raw_ast, new_ast, unit)
        }
        else if (unit.type === grammarType.composite) {
            return rewrite_composite(raw_ast, new_ast, unit)
        }
        else if (unit.type === grammarType.option) {
            return rewrite_option(raw_ast, new_ast, unit)
        }
    }

    return {
        rewrite: function (raw_ast) {
            return get_option_ast(raw_ast,option)
        }
    }
}


var get_first_token = function (raw_branch_ast, config) {
    switch (config.type) {
        case grammarType.option:
            var branch = config.get_branch(raw_branch_ast.branch)
            var value = raw_branch_ast.value
            if (branch.isLeftSelfRec) {
                return get_first_token(value[0], config)
            }
            else {
                return get_first_token(value, branch.config)
            }
            break
        case grammarType.composite:
            return get_first_token(raw_branch_ast[0], config.config[0])
            break
        case grammarType.token:
            return raw_branch_ast
            break
        default:

    }
}

var get_last_token = function (raw_branch_ast, config) {
    switch (config.type) {
        case grammarType.option:
            var branch = config.get_branch(raw_branch_ast.branch)
            var value = raw_branch_ast.value
            if (branch.isLeftSelfRec) {
                if (value[1].length > 0) {
                    return get_last_token(value[1][value[1].length - 1], branch.config.config[branch.config.config-1])
                }
                else {
                    return get_last_token(value[0], config)
                }
            }
            else {
                return get_last_token(raw_branch_ast.value, branch.config)
            }
            break
        case grammarType.composite:
            return get_last_token(raw_branch_ast[raw_branch_ast.length - 1],config.config[config.config.length - 1])
            break
        case grammarType.token:
            return raw_branch_ast
            break
        default:

    }
    
    
}

var get_range = function (raw_branch_ast, ast, config) {
    var firstToken = get_first_token(raw_branch_ast,config)
    ast.__start = firstToken.__start
    ast.__end = get_last_token(raw_branch_ast, config).__end
}

