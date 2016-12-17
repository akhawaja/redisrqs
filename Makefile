BUILD_FILES=index.coffee
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

.PHONY: compile package
