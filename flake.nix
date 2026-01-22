{
  description = "Obsidian Vertex AI Mastermind plugin development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
    in {
      devShells.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_22
          pkgs.nodePackages.npm
        ];

        shellHook = ''
            # Set gcloud project for this repo
            gcloud config set project obsidian-vertex-ai-plugin 2>/dev/null || true
            
          echo "Entering Obsidian Vertex AI Mastermind development environment..."
          npm install
        '';
      };
    });
}
