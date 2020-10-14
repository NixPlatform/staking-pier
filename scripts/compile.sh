DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )
PROJECT_DIR=$DIR/../
SOLVERSION=0.6.12

export OPENZEPPELIN_NON_INTERACTIVE=true

echo "-----Compiling NBT contract"
cd $PROJECT_DIR/node_modules/NBT
npx oz compile --solc-version 0.6.12
cd $PROJECT_DIR
cp $PROJECT_DIR/node_modules/NBT/build/contracts/NBT.json $PROJECT_DIR/build/contracts/
