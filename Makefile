BUILD_FILES=redisrqs.coffee
DISTRIBUTION_DIR=dist

compile:
	@clear
	@echo "Compiling the coffee scripts..."
	@coffee -c --no-header $(BUILD_FILES)
	@echo "Finished."

package: compile
	@clear
	@echo "Packaging the scripts..."
	@coffee -c -o $(DISTRIBUTION_DIR)/ --no-header $(BUILD_FILES)
	@echo "Finished."

transpile_coffeescripts:
	./node_modules/.bin/coffee --compile --map --no-header --watch ./

transpile: transpile_coffeescripts


.PHONY: compile package
